#  Social Media Web Application

A full-stack social network application built using React, Node.js, and MySQL. This project demonstrates modern web development practices including React Hooks, Context API, React Query, JWT authentication, cookies, and responsive UI design.

---

##  Description

This is a full-stack Social Media Application where users can create profiles, share posts, like, comment, and follow other users. The application is designed with a modern UI and supports dynamic data fetching, authentication, and real-time-like interactions.

The frontend is built using React with Hooks, Context API, and React Query for efficient state management and API handling. The backend is powered by Node.js and Express, while MySQL is used for database management. Authentication is implemented using JWT and cookies for secure user sessions.

---

##  Features

-  User Authentication (JWT + Cookies)
-  User Profile (Profile & Cover Image)
-  Create, View, and Delete Posts
-  Like / Unlike Posts
-  Comment System
-  Follow / Unfollow Users
-  Dark Mode UI
-  Fully Responsive Design
-  Fast data fetching using React Query
-  Change personal information

---

## Tech Stack

**Frontend:**
- React.js
- SCSS / CSS
- React Hooks
- Context API
- React Query

**Backend:**
- Node.js
- Express.js

**Database:**
- MySQL

**Authentication & Tools:**
- JWT (JSON Web Token) for user authentication
- Cookies for session management
- Multer (File Uploads)
- Axios
- bcryptjs for password hashing and security  

---

##  Project Structure
```text
.
├── api/                  # Node.js + Express backend
│   ├── controllers/      # Logic for routes
│   ├── routes/           # API endpoints
│   └── connect.js        # MySQL connection logic
└── client/               # React frontend
    ├── src/
    │   ├── components/   # Reusable UI elements
    │   ├── context/      # Auth & Theme Context
    │   └── pages/        # View components (Home, Profile, Login)
    └── public/           # Static assets
```
---

##  Installation

### 1. Clone Repository

```bash
git clone https://github.com/shreyadiwakar/Social-Media-App.git
cd social-media-app
```
### 2. Backend Setup

```bash
cd api
npm install
npm start
```
### 3. Frontend Setup

```bash
cd client
npm install
npm start
```
##  Database Schema

The backend relies on six core tables. To set this up, ensure your MySQL workbench contains:

* **users:** `id, username, email, password, name, coverPic, profilePic, city, website`
* **posts:** `id, desc, img, userId, createdAt`
* **comments:** `id, desc, createdAt, userId, postId`
* **likes:** `id, userId, postId`
* **relationships:** `id, followerUserId, followedUserId`
* **stories:** `id, img, userId`

##  Key Concepts Used

- React Hooks (useState, useEffect)  
- Context API for global state management  
- React Query for API caching and data fetching  
- REST API development  
- JWT Authentication  
- File upload handling (Multer)  
- Relational database design (MySQL)  

---

##  Future Improvements

-  Notifications system  
-  Real-time chat feature  
-  Search users and posts  
  
