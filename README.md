Ticket Booking System

A full-stack ticket booking platform for movies and concerts that lets customers book seats from a real-time visual seat map, with automatic hold expiry, waitlist auto-assignment on cancellation, and QR-coded email confirmations.

Built as part of my internship project to demonstrate backend concurrency handling, real-time seat state management, and end-to-end booking workflows.

Overview

High-demand events sell out instantly and leave many customers with no recourse, while last-minute cancellations often go to waste with no automated reallocation. This system solves that by:

- Letting customers select seats from a live seat map (available / held / booked)
- Placing a time-limited hold on selected seats so two customers can never double-book the same seat
- Auto-releasing held seats if checkout is abandoned
- Maintaining a per-category waitlist that automatically offers a freed-up seat to the next customer in line, with a time-limited link to complete the booking
- Emailing a QR-coded ticket on every confirmed booking

Features

Admin
- Create and manage venues with custom seat layouts and seat categories (Premium, Standard, etc.)

Organiser
- Register / log in
- Create movie or event listings with venue, date, time, and per-category pricing
- View booking summary and revenue per event

Customer
- Register / log in
- Browse and filter events
- View a real-time visual seat map
- Select seats and hold them for a configurable TTL (e.g. 10 minutes)
- Receive a booking confirmation email with a QR code ticket
- Join a waitlist when an event/category is sold out
- Get notified and offered a seat automatically when one becomes available, with a time-limited window to confirm
- View booking history and cancel bookings

Demo

The screenshot below shows a completed booking flow — seat `A13` selected on the visual seat map, followed by a confirmed booking with reference number and generated QR ticket.

`docs/screenshot-booking-confirmed.png`

---

## 🛠️ Tech Stack

| Layer          | Technology                          |
|----------------|--------------------------------------|
| Frontend       | React                                |
| Backend        | Node.js, Express                     |
| Database       | PostgreSQL                           |
| Auth           | JWT-based, role-based (customer / organiser / admin) |
| QR Generation  | `qrcode` (Node.js library)           |
| Email Delivery | Nodemailer (free-tier SMTP, e.g. Gmail / Mailtrap / SendGrid) |
| Scheduling     | Node cron job / DB-level TTL expiry for seat hold release |
| Deployment     | Render / Vercel / Railway            |

System Design Highlights

### Seat Hold & TTL Mechanism
When a customer selects a seat, a `hold` record is created with a status of `HELD` and an `expires_at` timestamp (`now() + TTL`, default 10 minutes). A background scheduler periodically scans for expired holds and releases them back to `AVAILABLE`, updating the seat map in real time via WebSockets/polling.

### Concurrency Protection
Seat holds and bookings are protected against race conditions using database-level row locking (`SELECT ... FOR UPDATE`) and a unique constraint on `(show_id, seat_id, status)` so that two simultaneous requests for the same seat cannot both succeed — one is rejected with a "seat no longer available" response.

### Waitlist Auto-Assignment
Each seat category maintains a FIFO waitlist queue. When a booking is cancelled, the system finds the next eligible customer in the queue, creates a time-limited offer (hold + expiry), and sends them an email with a confirmation link. If they don't act in time, the offer expires and cascades to the next customer in line.

### QR Code & Email Delivery
On successful booking, a unique booking reference is generated and encoded into a QR code image, which is attached/embedded in a confirmation email sent via the configured SMTP provider.

*(Full write-up available in `docs/system-design.md`.)*

---

Project Structure

```
ticket-booking-system/
├── client/                 # React frontend
│   ├── src/
│   └── package.json
├── server/                 # Express backend
│   ├── src/
│   │   ├── controllers/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── services/        # hold TTL, waitlist, QR, email logic
│   │   └── middleware/
│   └── package.json
├── docs/
│   ├── system-design.md
│   └── screenshot-booking-confirmed.png
├── .env.example
└── README.md
```
Setup & Installation

### Prerequisites
- Node.js (v18+)
- PostgreSQL (v14+)
- npm or yarn

1. Clone the repository
```bash
git clone https://github.com/<your-username>/ticket-booking-system.git
cd ticket-booking-system
```

2. Backend setup
```bash
cd server
npm install
cp .env.example .env   # fill in your DB, JWT, and email credentials
npm run migrate        # run DB migrations
npm run dev
```

3. Frontend setup
```bash
cd client
npm install
npm start
```

4. Environment Variables (`.env.example`)
```env
PORT=5000
DATABASE_URL=postgresql://user:password@localhost:5432/ticket_booking
JWT_SECRET=your_jwt_secret
SEAT_HOLD_TTL_MINUTES=10
WAITLIST_OFFER_TTL_MINUTES=15
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=your_email@example.com
EMAIL_PASS=your_email_password
CLIENT_URL=http://localhost:3000
```
API Documentation

Full endpoint documentation is available in [`docs/API.md`](docs/API.md). Key endpoints include:

| Method | Endpoint                          | Description                          |
|--------|------------------------------------|---------------------------------------|
| POST   | `/api/auth/register`               | Register a new user                  |
| POST   | `/api/auth/login`                  | Log in and receive JWT               |
| GET    | `/api/events`                      | List/filter events                   |
| GET    | `/api/events/:id/seats`            | Get real-time seat map for an event  |
| POST   | `/api/seats/hold`                  | Place a temporary hold on seat(s)    |
| POST   | `/api/bookings`                    | Confirm booking from a held seat     |
| POST   | `/api/waitlist`                    | Join waitlist for a sold-out category|
| DELETE | `/api/bookings/:id`                | Cancel a booking                     |
| GET    | `/api/organiser/events/:id/summary`| Revenue/booking summary for organiser|

Database Schema (Summary)

- `users` — id, name, email, password_hash, role
- `venues` — id, name, layout metadata
- `seats` — id, venue_id, category, row, number
- `events` — id, organiser_id, venue_id, title, date, time
- `shows` — id, event_id, pricing per category
- `seat_status` — show_id, seat_id, status (AVAILABLE / HELD / BOOKED), expires_at
- `bookings` — id, user_id, show_id, seat_id, reference, status, qr_code_url
- `waitlist` — id, user_id, show_id, category, position, status

Full schema with relationships is documented in [`docs/schema.sql`](docs/schema.sql).

Live Demo

Hosted App: `<add your deployed URL here>`

License

This project was built for educational/internship purposes.
