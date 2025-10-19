# Citation Verifier Documentation

This document provides a comprehensive guide to the Citation Verifier application, including instructions for users, developers, and API consumers.

## 1. User Guide

### 1.1. Introduction

The Citation Verifier is a tool designed to help researchers, students, and academics verify the citations in their work. It analyzes a given text, identifies the claims and citations, and provides an assessment of the citation quality.

### 1.2. How to Use

1.  **Enter Your Text:** Paste the text you want to analyze into the text area on the main page.
2.  **Enter Your Token:** In the designated field, enter the authentication token provided to you.
3.  **Analyze & Verify Citations:** Click the "Analyze & Verify Citations" button to start the analysis.
4.  **View the Results:** The analysis results will be displayed on the right-hand side of the page.

### 1.3. Understanding the Results

The analysis results are divided into three main sections:

*   **Extraction:** This section shows the key claims and citations that were extracted from your text.
*   **Search Results:** For each key claim, this section provides a credibility score, supporting and contradicting evidence, and an assessment of the citation status.
*   **Review:** This section provides an overall assessment of your text, including its strengths, weaknesses, and recommendations for improvement.

---

## 2. Developer Guide

### 2.1. Project Structure

The project is a monorepo with two main components:

*   `frontend`: A React application built with Vite that provides the user interface.
*   `backend`: A Cloudflare Worker that provides the API for analyzing text.

### 2.2. Local Development Setup

1.  **Prerequisites:**
    *   Node.js and npm
    *   Wrangler CLI

2.  **Installation:**
    *   Clone the repository.
    *   Run `npm install` in the root directory to install the dependencies for the frontend.
    *   Run `npm install` in the `backend` directory to install the dependencies for the backend.

3.  **Running the Frontend:**
    *   `cd` into the root directory.
    *   Run `npm run dev` to start the Vite development server for the frontend.

4.  **Running the Backend:**
    *   `cd` into the `backend` directory.
    *   Run `npm run dev` to start the development server for the Cloudflare Worker.

### 2.3. Deploying the Application

**Frontend:**

The frontend is deployed to Cloudflare Pages. The deployment is automatically triggered on every push to the `main` branch.

**Backend:**

The backend is deployed to Cloudflare Workers. To deploy the backend, run the following command from the `backend` directory:

```bash
npm run deploy
```

### 2.4. External Services

The backend uses the following external services:

*   **DeepSeek API:** The DeepSeek API is used for the core text analysis functionality. You need to set the `DEEPSEEK_API_KEY` secret using the Wrangler CLI.
*   **Admin Secret:** The admin endpoints are protected by a secret token. You need to set the `ADMIN_SECRET` secret using the Wrangler CLI.

To set secrets, use the following command from the `backend` directory:

```bash
npx wrangler secret put SECRET_NAME
```

---

## 3. API Reference

### 3.1. Authentication

All API requests require authentication. The API uses a bearer token authentication scheme.

The user token has the format `usr_[timestamp]_[random]`, for example: `usr_1760877701604_0b7731c3061c`.

To authenticate, include an `Authorization` header with your request:

`Authorization: Bearer YOUR_USER_TOKEN`

Admin endpoints require an additional `X-Admin-Token` header.

### 3.2. Endpoints

#### `POST /`

Analyzes the given text.

**Request Body:**

```json
{
  "text": "This is the text to be analyzed."
}
```

**Response:**

Returns a JSON object with the analysis results.

#### `GET /admin/users`

Lists all users.

**Headers:**

*   `X-Admin-Token`: Your admin token.

**Response:**

Returns a JSON object with a list of users.

#### `POST /admin/users`

Creates a new user.

**Headers:**

*   `X-Admin-Token`: Your admin token.

**Request Body:**

```json
{
  "email": "user@example.com",
  "limit": 5
}
```

**Response:**

Returns a JSON object with the new user's details, including the generated token.

```json
{
  "success": true,
  "token": "usr_1760877701604_0b7731c3061c",
  "email": "test@example.com",
  "limit": 5,
  "message": "User created successfully"
}
```

#### `GET /admin/users/:token`

Retrieves a single user by their token.

**Headers:**

*   `X-Admin-Token`: Your admin token.

**URL Parameters:**

*   `token`: The user's token.

**Response:**

Returns a JSON object with the user's details.

#### `PUT /admin/users/:token`

Updates a user's limit or status.

**Headers:**

*   `X-Admin-Token`: Your admin token.

**URL Parameters:**

*   `token`: The user's token.

**Request Body:**

```json
{
  "limit": 10,
  "status": "suspended"
}
```

**Response:**

Returns a JSON object with the updated user details.

#### `DELETE /admin/users/:token`

Deletes a user.

**Headers:**

*   `X-Admin-Token`: Your admin token.

**URL Parameters:**

*   `token`: The user's token.

**Response:**

Returns a JSON object with a success message.
