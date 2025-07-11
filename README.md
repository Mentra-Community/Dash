# Mentra Dash

Mentra Dash is a real-time running (and soon to be cycling) tracker application built for smart glasses using the Mentra SDK. It provides runners with live stats on their glasses display, including distance, pace, and moving time, and features a web-based "dashboard" for starting, stopping, and reviewing runs.

## Features

*   **Live Glasses Display:** Real-time stats, including a "Moving Time", a 2-minute rolling average "Pace," and “Distance” are displayed directly on the user's smart glasses.
*   **Webview Dashboard:** A web interface allows users to start and end their runs and view a final summary of their activity.
*   **Live Map & Path Tracing:** During a run, users can open a map view to see their current location and a green trail tracing the path they've run.
*   **Post-Run Summary:** After a run, the webview displays a complete summary, including a map of the route, total distance, moving time, and average pace.

## How It Works

The project is a "monorepo" containing two main parts:

*   **The Backend Server (`/src`):** A Node.js application built with Express and the Mentra SDK. It's responsible for all the core logic: connecting to the glasses, processing GPS data, calculating all the stats in real-time, and serving the webview.
*   **The Frontend Webview (`/webview`):** A React application built with Vite. This provides the user interface that runs on the user's phone, acting as a dashboard and control panel for the app.

## Getting Started

To get the application running locally for development, you will need Node.js and Bun installed.

### 1. Install Dependencies

This project has two separate sets of dependencies that need to be installed. Run the following commands from the root directory of the project:

```bash
bun install
bun add @mentra/sdk
bun add -d typescript tsx @types/node


# Install the frontend webview dependencies
cd webview
bun install
```

### 2. Set Up Environment Variables

You will need to create two `.env` files to store your API keys.
Follow the examples `.env` files in the root and in `/webview` folder

### 3. Build and Run the Application

Once your dependencies and environment variables are set up, you can build and run the application.

**Build the Webview:** First, you need to build the frontend application. Run this command from inside the `/webview` directory:

```bash
# From inside the /webview directory
bun run build
```

**Run the Server:** Now, go back to the root directory and start the main server. For development with automatic reloading, use:

```bash
# From the root directory
bun run dev
```

The server will start

### 4. Connect to Mentra

To see the app in action on your glasses, you will need to expose your local server to the internet.

*   Use a tunneling service like ngrok to create a public URL for your local server (e.g., `ngrok http 4000`).
*   In the Mentra Developer Console, create an app and set its "Public URL" to your ngrok URL. Also, ensure you add your ngrok URL with the `/webview` path (e.g., `https://your-url.ngrok.app/webview`) to the "Webview URL" field.
*   Start the app from your Mentra phone application to see the live display on your glasses and access the webview dashboard.