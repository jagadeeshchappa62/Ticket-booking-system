const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const QRCode = require('qrcode');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize In-Memory SQLite Database for Instant Setup
const db = new sqlite3.Database(':memory:');

// Database Schema Initialization
db.serialize(() => {
  db.run(`CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    category TEXT
  )`);

  db.run(`CREATE TABLE seats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER,
    seat_number TEXT,
    status TEXT DEFAULT 'available',
    held_by TEXT,
    hold_expires_at INTEGER,
    UNIQUE(event_id, seat_number)
  )`);

  db.run(`CREATE TABLE bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_ref TEXT,
    event_id INTEGER,
    seat_number TEXT,
    customer_email TEXT,
    qr_code_url TEXT
  )`);

  db.run(`CREATE TABLE waitlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER,
    customer_email TEXT,
    created_at INTEGER
  )`);

  // Seed Default Event and 20 Seats
  db.run(`INSERT INTO events (title, category) VALUES ('Delhi Express 20801', 'Music')`);
  const stmt = db.prepare(`INSERT INTO seats (event_id, seat_number, status) VALUES (1, ?, 'available')`);
  for (let i = 1; i <= 20; i++) {
    stmt.run(`A${i}`);
  }
  stmt.finalize();
});

// Periodic Job: Handle Seat Hold Expirations (TTL = 30 seconds for quick testing)
setInterval(() => {
  const now = Date.now();
  db.all(
    `SELECT * FROM seats WHERE status = 'held' AND hold_expires_at <= ?`,
    [now],
    (err, rows) => {
      if (err || !rows) return;
      rows.forEach((seat) => {
        db.run(
          `UPDATE seats SET status = 'available', held_by = NULL, hold_expires_at = NULL WHERE id = ?`,
          [seat.id],
          () => {
            console.log(`[TTL Expired] Seat ${seat.seat_number} auto-released.`);
            io.emit('seatUpdated', { seatNumber: seat.seat_number, status: 'available' });
          }
        );
      });
    }
  );
}, 2000);

// API Endpoints

// Get all seats for an event
app.get('/api/seats', (req, res) => {
  db.all(`SELECT seat_number, status, hold_expires_at FROM seats WHERE event_id = 1`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Hold a seat (Concurrency Protected)
app.post('/api/seats/hold', (req, res) => {
  const { seatNumber, userEmail } = req.body;
  const holdDurationMs = 30000; // 30-second TTL
  const expiresAt = Date.now() + holdDurationMs;

  db.serialize(() => {
    db.get(
      `SELECT status FROM seats WHERE event_id = 1 AND seat_number = ?`,
      [seatNumber],
      (err, seat) => {
        if (err || !seat) return res.status(400).json({ error: 'Invalid seat' });
        if (seat.status !== 'available') {
          return res.status(409).json({ error: 'Seat is no longer available' });
        }

        db.run(
          `UPDATE seats SET status = 'held', held_by = ?, hold_expires_at = ? WHERE event_id = 1 AND seat_number = ? AND status = 'available'`,
          [userEmail, expiresAt, seatNumber],
          function (updateErr) {
            if (updateErr || this.changes === 0) {
              return res.status(409).json({ error: 'Concurrency conflict: Seat was just grabbed by someone else!' });
            }
            io.emit('seatUpdated', { seatNumber, status: 'held' });
            res.json({ success: true, expiresAt });
          }
        );
      }
    );
  });
});

// Confirm Booking & Generate QR Ticket
app.post('/api/seats/book', async (req, res) => {
  const { seatNumber, userEmail } = req.body;
  const bookingRef = 'REF-' + Math.random().toString(36).substring(2, 9).toUpperCase();

  try {
    const qrDataUrl = await QRCode.toDataURL(JSON.stringify({ bookingRef, seatNumber, userEmail }));

    db.run(
      `UPDATE seats SET status = 'booked', held_by = NULL, hold_expires_at = NULL WHERE event_id = 1 AND seat_number = ?`,
      [seatNumber],
      function (err) {
        if (err || this.changes === 0) {
          return res.status(400).json({ error: 'Seat hold expired or unavailable' });
        }

        db.run(
          `INSERT INTO bookings (booking_ref, event_id, seat_number, customer_email, qr_code_url) VALUES (?, 1, ?, ?, ?)`,
          [bookingRef, seatNumber, userEmail, qrDataUrl]
        );

        console.log(`[Email Dispatched] QR Ticket sent to ${userEmail} for seat ${seatNumber}`);
        io.emit('seatUpdated', { seatNumber, status: 'booked' });
        res.json({ success: true, bookingRef, qrDataUrl });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate ticket' });
  }
});

// Join Waitlist if Sold Out
app.post('/api/waitlist', (req, res) => {
  const { userEmail } = req.body;
  db.run(
    `INSERT INTO waitlist (event_id, customer_email, created_at) VALUES (1, ?, ?)`,
    [userEmail, Date.now()],
    function (err) {
      if (err) return res.status(500).json({ error: 'Failed to join waitlist' });
      res.json({ success: true, message: 'Added to waitlist!' });
    }
  );
});

// Cancel Booking & Reassign to Waitlist
app.post('/api/seats/cancel', (req, res) => {
  const { seatNumber, userEmail } = req.body;

  db.run(
    `UPDATE seats SET status = 'available' WHERE event_id = 1 AND seat_number = ?`,
    [seatNumber],
    function (err) {
      if (err || this.changes === 0) return res.status(400).json({ error: 'Cancellation failed' });

      io.emit('seatUpdated', { seatNumber, status: 'available' });

      // Check Waitlist for Auto-Assignment
      db.get(`SELECT * FROM waitlist WHERE event_id = 1 ORDER BY created_at ASC LIMIT 1`, [], (wErr, nextUser) => {
        if (nextUser) {
          db.run(`DELETE FROM waitlist WHERE id = ?`, [nextUser.id]);
          console.log(`[Waitlist Offer] Seat ${seatNumber} automatically offered to waitlisted user: ${nextUser.customer_email}`);
        }
      });

      res.json({ success: true, message: 'Booking cancelled.' });
    }
  );
});

// Socket.io Connection Logic
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});