# API Test Case Generator

A full-stack tool that generates JUnit 5 test cases from API JSON specifications using rule-based logic.

## Quick Start

### Backend (Express)
```bash
cd backend
npm install
npm run dev
```
Runs on **http://localhost:4000**

### Frontend (React + Vite)
```bash
cd frontend
npm install
npm run dev
```
Runs on **http://localhost:3000**

## Usage

1. Paste your API JSON spec into the textarea (or click **Load Sample**)
2. Click **Generate Test Cases**
3. View generated test cases in the table or switch to the **JUnit Code** tab
4. Click **Download JUnit File** to save the `.java` file

## API JSON Format

```json
{
  "method": "POST",
  "url": "/api/users/{id}",
  "headers": { "Authorization": "Bearer token123" },
  "pathParams": { "id": "42" },
  "queryParams": { "verbose": "true" },
  "body": { "name": "John", "email": "john@example.com", "age": 30 },
  "expectedStatus": 200
}
```

## Rules Applied

- Happy path test
- Missing authorization header → 401
- Wrong HTTP method → 405
- Missing / invalid path parameters → 400 / 404
- Empty body on POST/PUT/PATCH → 400
- Missing required body fields → 400
- Invalid field types → 400
- Missing query parameters → 400
