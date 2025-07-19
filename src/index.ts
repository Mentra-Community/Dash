/**
 * Main entry point for the Mentra-Dash running tracker app.
 * This file sets up the app server, defines the application logic for tracking runs,
 * and creates the API endpoints for the webview interface.
 */

import { AppServer, AppSession, ViewType, type AuthenticatedRequest } from '@mentra/sdk';
import cors from 'cors';
import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'path';

// Load configuration from environment variables
const PACKAGE_NAME = process.env.PACKAGE_NAME || "com.example.myfirstaugmentosapp";
const PORT = parseInt(process.env.PORT || "3000");
const AUGMENTOS_API_KEY = process.env.AUGMENTOS_API_KEY;

if (!AUGMENTOS_API_KEY) {
    console.error("AUGMENTOS_API_KEY environment variable is required");
    process.exit(1);
}

// using haversine formula for now. will look into other options later
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3958.8; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

/**
 * Formats a decimal number representing minutes into a MM:SS string for display.
 * Also handles the edge case where rounding results in 60 seconds.
 * @param paceInMinutes - The pace in decimal minutes (e.g., 10.5 for 10:30).
 * @returns A formatted string like "10:30 /mi".
 */
function formatPace(paceInMinutes: number): string {
    let minutes = Math.floor(paceInMinutes);
    let seconds = Math.round((paceInMinutes - minutes) * 60);

    // Handle the case where rounding results in 60 seconds
    if (seconds === 60) {
        minutes += 1;
        seconds = 0;
    }

    return `${minutes}:${seconds.toString().padStart(2, '0')} /mi`;
}

/**
 * Prepends a specified number of spaces to a line of text for indentation.
 * @param line - The string to indent.
 * @param indent - The number of spaces to add.
 * @returns The indented string.
 */
function indentLine(line: string, indent: number = 0): string {
    return ' '.repeat(indent) + line;
}

/**
 * Formats an array of label-value pairs into a two-column, left-aligned text block.
 * It automatically pads labels to the length of the longest label to ensure values align.
 * @param lines - An array of [label, value] tuples.
 * @param indent - The number of spaces to indent the entire block.
 * @returns A single string with all lines formatted and joined by newlines.
 */
function formatAlignedText(lines: [string, string][], indent: number = 4): string {
    // Use a fixed width based on the longest possible label ("Moving Time")
    const fixedLabelWidth = "Moving Time".length + 2; // +2 for extra padding

    const formattedLines = lines.map(([label, value]) => {
        // Pad each label to the fixed width
        const paddedLabel = label.padEnd(fixedLabelWidth);
        return `${' '.repeat(indent)}${paddedLabel}${value}`;
    }).join('\n');

    return formattedLines;
}

/**
 * Manages the complete state and logic for a single running session for one user.
 * This class encapsulates all properties of a run, such as distance, time, pace,
 * and the user's location history. It also contains the methods to start, stop,
 * and process location updates for the run.
 */
class Run {
    // --- Session State ---
    /** The last known GPS location of the user. Used to calculate distance deltas. */
    public lastLocation: { lat: number; lng: number; timestamp: number } | null = null;
    /** The total distance covered in the run, in miles. */
    public totalDistance: number = 0;
    /** A flag indicating if the run is currently in an auto-paused state. */
    public isPaused: boolean = false;
    /** The timestamp of the last time the user was detected to be moving. Used for pause detection. */
    public timeOfLastMovement: number = 0;
    
    // --- Time-keeping State (Stopwatch Model) ---
    /** The timestamp when the run officially started (after the warm-up). */
    private initialStartTime: number = 0;
    /** The timestamp when the current pause began. */
    private pauseStartTime: number = 0;
    /** An accumulator for the total time spent in all completed pause intervals. */
    private totalPausedTime: number = 0;
    /** An accumulator for the duration of completed, "active" run segments. */
    private activeTime: number = 0; 
    /** The timestamp when the current "active" run segment began. */
    private startTime: number = 0; 

    // --- Pace Calculation ---
    /** The average pace over the entire duration of the run. */
    public averagePace: number = 0; 
    /** The rolling pace calculated over the last `ROLLING_WINDOW_MS`. */
    public rollingPace: number = 0; 
    /** A complete history of all GPS points for the run. Used for the map trail. */
    public fullLocationHistory: Array<{ lat: number; lng: number; timestamp: number }> = [];
    private rollingPaceHistory: Array<{ lat: number; lng: number; timestamp: number }> = [];

    // --- Timers & Intervals ---
    /** The timer that updates the glasses display every second. */
    public timeUpdateInterval: NodeJS.Timeout | null = null;
    /** The timer that checks for prolonged connection issues. */
    public locationTimeoutCheck: NodeJS.Timeout | null = null;

    // --- Configuration Constants ---
    /** The duration of the rolling window for pace calculation (e.g., 2 minutes). */
    private readonly ROLLING_WINDOW_MS = 120000;
    /** The time the user must be stationary before a pause is triggered. */
    private readonly PAUSE_THRESHOLD_MS = Number.MAX_SAFE_INTEGER;
    /** The duration after which a warning is logged if no GPS data is received. */
    private readonly LOCATION_TIMEOUT_MS = 10000; 
    /** The minimum speed in MPH to be considered "moving". */
    private readonly MIN_SPEED_MPH = 1;
    /** An arbitrary maximum speed to filter out erroneous GPS data. */
    private readonly MAX_SPEED_MPH = 24;
    /** The minimum distance a user must move between updates to be counted, to filter GPS jitter. */
    private readonly MIN_MOVEMENT_MI = 0.0006;
    /** The duration of continuous movement required at the start of a run before stats are shown. */
    private readonly WARM_UP_PERIOD_MS = 15000;
    /** A flag indicating if the run is currently in its initial warm-up phase. */
    public isWarmingUp: boolean = true;
    /** An accumulator for continuous movement time, used only during warm-up. */
    public continuousMovementTime: number = 0;

    // --- Minimum Activity Thresholds ---
    /** The minimum time a run must last to be considered a valid activity. */
    private readonly MIN_ACTIVITY_TIME_MS = 25000;
    /** The minimum distance a run must cover to be considered a valid activity. */
    private readonly MIN_ACTIVITY_DISTANCE_MI = 0.03;

    /** The current status of the run, controlled by the webview. */
    public runStatus: 'stopped' | 'running' = 'stopped';

    /** The TPA session object, used to send data back to the glasses. */
    private session: AppSession;

    constructor(session: AppSession) {
        this.session = session;
    }

    /**
     * Resets all state variables to their initial values and starts the timers
     * for the glasses display and location timeout checks. It also contains the
     * "UI Test Mode" block for rapidly testing display alignment.
     */
    public start() {
        if (this.runStatus === 'running') {
            console.log('Run is already in progress.');
            return;
        }
        console.log('Starting a new run...');
        this.runStatus = 'running';

        // Reset all session state
        this.lastLocation = null;
        this.totalDistance = 0;
        this.averagePace = 0;
        this.rollingPace = 0;
        this.isPaused = false;
        this.fullLocationHistory = [];
        this.isWarmingUp = true;
        this.continuousMovementTime = 0;
        this.timeOfLastMovement = Date.now();

        // Reset new time-keeping state
        this.initialStartTime = 0;
        this.pauseStartTime = 0;
        this.totalPausedTime = 0;
        this.activeTime = 0;
        this.startTime = 0;

        this.stopTimers(); // Clear any existing timers before starting new ones

        // start location timeout check
        this.locationTimeoutCheck = setInterval(() => {
            const lastKnownTime = this.lastLocation?.timestamp || 0;
            const timeSinceLastUpdate = Date.now() - lastKnownTime;
            if (this.isPaused && lastKnownTime > 0 && timeSinceLastUpdate > this.LOCATION_TIMEOUT_MS) {
                console.log(`⚠️ Paused and no location updates for over ${this.LOCATION_TIMEOUT_MS / 1000}s. Last update at ${new Date(lastKnownTime).toLocaleTimeString()}`);
            }
        }, this.LOCATION_TIMEOUT_MS);

        // start timer to update time display every second
        this.timeUpdateInterval = setInterval(() => {
            if (this.runStatus !== 'running') return;

            // Determine what content to show based on the run state
            let displayText = '';
            if (this.isWarmingUp) {
                // During initial warm-up, only show "Start moving" message
                if (this.lastLocation === null) {
                    displayText = '\n\n\nStart moving to begin your run.';
                } else {
                    displayText = '\n\n\nStart moving to begin your run.';
                }
            } else if (this.isPaused) {
                // If paused after warm-up, show the paused message
                displayText = '\n\n\n         Run Paused';
            } else {
                // Once running normally, show the full stats
                const movingTime = this.getMovingTime();
                const displayTime = `${Math.floor(movingTime / 1000 / 60)}:${Math.floor((movingTime / 1000) % 60).toString().padStart(2, '0')}`;
                
                const paceDisplay = this.rollingPace > 0 ? formatPace(this.rollingPace) : '--:-- /mi';

            const mainStatsLines: [string, string][] = [
                ['Distance         ', `${this.totalDistance.toFixed(2)} mi`],
                    ['Pace              ', paceDisplay],
                    ['Moving Time    ', displayTime]
                ];
                displayText = '\n' + formatAlignedText(mainStatsLines, 26);
            }

            this.session.layouts.showTextWall(
                displayText,
                { view: ViewType.MAIN }
            );
        }, 1000);
    }

    /**
     * Stops all timers, finalizes the run's stats, and sends the final summary
     * or an "activity too short" message to the glasses display.
     */
    public stop() {
        // If the run was active when we stopped, finalize the last segment.
        if (!this.isPaused && this.runStatus === 'running' && !this.isWarmingUp) {
            this.activeTime += Date.now() - this.startTime;
        }

        console.log('Stopping the run...');
        this.runStatus = 'stopped';
        this.stopTimers();

        // Get the final, authoritative stats
        const finalStats = this.getStats();

        // Check if the activity meets minimum thresholds
        if (!finalStats.isValidActivity) {
            // Show "too short" message on glasses
            this.session.layouts.showTextWall(
                '\n\n\nActivity too short. Run longer to gather more data',
                { view: ViewType.MAIN }
            );
        } else {
            // Show final summary on glasses using the definitive stats
            const movingTime = this.getMovingTime();
            const displayTime = `${Math.floor(movingTime / 1000 / 60)}:${Math.floor((movingTime / 1000) % 60).toString().padStart(2, '0')}`;
            const paceDisplay = (pace: number) => (pace > 0 ? formatPace(pace) : '--:-- /mi');

            const finalStatsLines: [string, string][] = [
                ['Avg Pace       ', paceDisplay(finalStats.averagePace)],
                ['Distance         ', `${finalStats.totalDistance.toFixed(2)} mi`],
                ['Moving Time   ', displayTime]
            ];

            const summaryText = '                             Run Complete!\n\n' + formatAlignedText(finalStatsLines, 20);

            this.session.layouts.showTextWall(
                summaryText,
                { view: ViewType.MAIN }
            );
        }
    }

    /**
     * A helper method to clear all active `setInterval` timers for the session.
     */
    private stopTimers() {
        if (this.timeUpdateInterval) {
            clearInterval(this.timeUpdateInterval);
            this.timeUpdateInterval = null;
        }
        if (this.locationTimeoutCheck) {
            clearInterval(this.locationTimeoutCheck);
            this.locationTimeoutCheck = null;
        }
    }

    /**
     * This is the core logic engine for the run. It is called on every GPS update
     * and is responsible for:
     * 1. Calculating deltas (distance, time, speed) from the last point.
     * 2. Managing the state machine for warming up, running, and pausing.
     * 3. Accumulating total distance.
     * 4. Calculating the rolling pace.
     */
    public handleLocationUpdate(data: { lat: number; lng: number; timestamp?: Date }) {
        if (this.runStatus !== 'running') return;

        const currentTime = data.timestamp ? new Date(data.timestamp).getTime() : Date.now();

        if (!this.lastLocation) {
            this.lastLocation = { lat: data.lat, lng: data.lng, timestamp: currentTime };
            this.fullLocationHistory.push(this.lastLocation);
            this.timeOfLastMovement = currentTime; // Initialize on first point
            return;
        }

        const distanceDelta = calculateDistance(this.lastLocation.lat, this.lastLocation.lng, data.lat, data.lng);
        const timeDeltaMs = currentTime - this.lastLocation.timestamp;
        const speedMph = (timeDeltaMs > 0) ? (distanceDelta / (timeDeltaMs / (1000 * 60 * 60))) : 0;
        
        // Handle warm-up logic first
        if (this.isWarmingUp) {
            if (speedMph >= this.MIN_SPEED_MPH) {
                // Start the timer and distance accumulation on the first valid movement
                if (this.continuousMovementTime === 0) {
                    this.startTime = currentTime;
                }
                this.continuousMovementTime += timeDeltaMs;
                
                // Accumulate distance during warmup
                if (distanceDelta > this.MIN_MOVEMENT_MI) {
                    this.totalDistance += distanceDelta;
                }

                if (this.continuousMovementTime >= this.WARM_UP_PERIOD_MS) {
                    this.isWarmingUp = false;
                    // Finalize the warm-up segment as the first official time segment
                    this.activeTime = this.continuousMovementTime;
                    this.startTime = currentTime; // Start the first "real" segment
                    console.log(`--- Warm-up complete. Initial time: ${this.activeTime / 1000}s, Initial distance: ${this.totalDistance.toFixed(3)} mi ---`);
                }
            } else {
                // If they stop moving during warm-up, reset everything
                this.continuousMovementTime = 0;
                this.startTime = 0;
                this.totalDistance = 0;
                this.fullLocationHistory = []; // Also clear history for a fresh start
            }
        }

        // State transitions for pause/resume, only after warm-up is complete
        if (!this.isWarmingUp) {
            const wasPaused = this.isPaused;

            if (speedMph < this.MIN_SPEED_MPH) {
                if (!wasPaused && (currentTime - this.timeOfLastMovement > this.PAUSE_THRESHOLD_MS)) {
                    this.isPaused = true;
                    // Finalize the segment that just ended
                    const segmentDuration = this.timeOfLastMovement - this.startTime;
                    this.activeTime += segmentDuration;
                    console.log(`--- Paused. Segment of ${segmentDuration/1000}s added. Active time is now: ${this.activeTime / 1000}s ---`);
                }
            } else {
                if (wasPaused) {
                    // Start a new time segment on resume
                    this.startTime = currentTime;
                    console.log('--- Resumed ---');
                }
                this.isPaused = false;
                this.timeOfLastMovement = currentTime; // Update on valid movement
            }
        }

        const newLocation = { lat: data.lat, lng: data.lng, timestamp: currentTime };
        this.fullLocationHistory.push(newLocation);
        this.lastLocation = newLocation;

        // Only do pace and distance calculations if not paused and warmed up
        if (!this.isPaused && !this.isWarmingUp) {
            // --- Rolling Pace Calculation ---
            const windowStartTime = currentTime - this.ROLLING_WINDOW_MS;
            const currentWindow = this.fullLocationHistory.filter(p => p.timestamp >= windowStartTime);

            if (currentWindow.length > 1) {
                const { distance: windowDistance } = this.getDistanceOfPath(currentWindow);
                const windowDurationMs = currentWindow[currentWindow.length - 1].timestamp - currentWindow[0].timestamp;
                const windowDurationMinutes = windowDurationMs / 60000;

                this.rollingPace = (windowDistance > 0 && windowDurationMinutes > 0) 
                    ? (windowDurationMinutes / windowDistance) 
                    : 0;
            } else {
                this.rollingPace = 0;
            }

            // --- Update Totals ---
            if (distanceDelta > this.MIN_MOVEMENT_MI) {
                this.totalDistance += distanceDelta;
            }
        }
    }

    /**
     * A helper function to calculate the total distance and moving time of a given path of GPS points.
     * @param path - An array of location points.
     * @returns An object containing the calculated distance and time.
     */
    private getDistanceOfPath(path: Array<{ lat: number; lng: number; timestamp: number }>): { distance: number, time: number } {
        let totalDistance = 0;
        let totalTime = 0;

        for (let i = 1; i < path.length; i++) {
            const p1 = path[i - 1];
            const p2 = path[i];
            if (p1 && p2) {
                const timeDeltaSegment = p2.timestamp - p1.timestamp;
                const distanceSegment = calculateDistance(p1.lat, p1.lng, p2.lat, p2.lng);
                if (distanceSegment > this.MIN_MOVEMENT_MI) {
                    totalDistance += distanceSegment;
                    totalTime += timeDeltaSegment;
                }
            }
        }
        return { distance: totalDistance, time: totalTime };
    }

    /**
     * The single source of truth for the current moving time. It correctly calculates
     * the total active time by summing completed segments and adding the duration of
     * the current, live segment.
     * @returns The total moving time in milliseconds.
     */
    private getMovingTime(): number {
        if (this.runStatus !== 'running' || this.isWarmingUp) {
            return this.activeTime;
        }

        if (this.isPaused) {
            return this.activeTime;
        }

        // Live, running time is the sum of completed segments plus the current, active segment
        return this.activeTime + (Date.now() - this.startTime);
    }

    /**
     * Calculates and returns the complete, current statistics for the run. This is called
     * by the webview API and the stop() method to get a final, authoritative state.
     */
    public getStats() {
        const movingTime = this.getMovingTime();
        
        const totalTimeMin = movingTime / (1000 * 60);
        const averagePace = (this.totalDistance > 0 && totalTimeMin > 0) ? (totalTimeMin / this.totalDistance) : 0;

        const meetsMinimumThresholds = movingTime >= this.MIN_ACTIVITY_TIME_MS && 
                                      this.totalDistance >= this.MIN_ACTIVITY_DISTANCE_MI;

        return {
            totalDistance: this.totalDistance,
            activeTime: movingTime,
            averagePace: averagePace,
            runStatus: this.runStatus,
            rollingPace: this.rollingPace,
            isValidActivity: meetsMinimumThresholds,
            locationHistory: this.fullLocationHistory,
        };
    }
}

/**
 * The main TPA server class. It extends the Mentra SDK's `AppServer` and is responsible
 * for managing all user sessions and setting up the Express API endpoints
 * that the webview communicates with.
 */
class MyMentraApp extends AppServer {
    /** A map to store the active `Run` instance for each session ID. */
    private activeRuns = new Map<string, Run>(); 
    /** A map to look up a user's current session ID. */
    private userIdToSessionId = new Map<string, string>(); 
    /** A map to look up a session's user ID. */
    private sessionIdToUserId = new Map<string, string>(); 

    constructor(options: { packageName: string; apiKey: string; port: number; }) {
        super(options);
        this.setupExpress();
    }

    /**
     * Sets up the Express.js server, including CORS, JSON parsing, static file
     * serving for the webview, and the custom API routes (/api/run/...).
     */
    private setupExpress() {
        const app = this.getExpressApp();
        app.use(cors()); // Allow requests from webview
        app.use(express.json());

        // Serve the static React webview files
        const webviewPath = path.join(__dirname, '..', 'webview', 'dist');
        app.use('/webview', express.static(webviewPath));
        app.get('/webview/*', (req: Request, res: Response) => {
            res.sendFile(path.join(webviewPath, 'index.html'));
                    });

        // Middleware to find and attach the active run to the request
        const getRunMiddleware = (req: Request, res: Response, next: NextFunction) => {
            const userId = (req as AuthenticatedRequest).authUserId;
            if (!userId) {
                res.status(401).json({ error: 'User not authenticated.' });
                return;
            }
            const sessionId = this.userIdToSessionId.get(userId);
            if (!sessionId) {
                res.status(404).json({ error: 'Active session not found for this user.' });
                return;
            }
            const run = this.activeRuns.get(sessionId);
            if (!run) {
                res.status(404).json({ error: 'Active run not found for this session.' });
                return;
            }
            (req as any).run = run; // Attach run to the request object
            next();
        };

        app.post('/api/run/start', getRunMiddleware, (req: Request, res: Response) => {
            const run = (req as any).run as Run;
            run.start();
            res.status(200).json({ message: 'Run started successfully.' });
        });

        app.post('/api/run/stop', getRunMiddleware, (req: Request, res: Response) => {
            const run = (req as any).run as Run;
            run.stop();
            res.status(200).json(run.getStats());
        });

        app.get('/api/run/stats', getRunMiddleware, (req: Request, res: Response) => {
            const run = (req as any).run as Run;
            res.status(200).json(run.getStats());
        });
    }

    /**
     * This method is called by the Mentra Cloud whenever a new user session starts.
     * It creates and stores a new `Run` instance for the user and sets up all the
     * necessary event listeners for location data, errors, and disconnections.
     */
    protected override async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
        console.log(`New session: ${sessionId} for user ${userId}`);

        // Clean up any old sessions for this user, just in case
        const oldSessionId = this.userIdToSessionId.get(userId);
        if (oldSessionId) {
            this.activeRuns.delete(oldSessionId);
            this.sessionIdToUserId.delete(oldSessionId);
        }

        // Set up new session
        const run = new Run(session);
        this.activeRuns.set(sessionId, run);
        this.userIdToSessionId.set(userId, sessionId);
        this.sessionIdToUserId.set(sessionId, userId);

        session.layouts.showTextWall(
            'Dash\n\n' +
            'Open Dash on your phone to start/end your run.\n\nMentra must stay open if using Dash on iPhone (fixing in next release)',
            { view: ViewType.MAIN }
        );

        const stopLocationStream = session.location.subscribeToStream(
            { accuracy: 'realtime' }, 
            (data) => {
            const run = this.activeRuns.get(sessionId);
            if (run) {
                run.handleLocationUpdate(data);
            }
            }
        );

        session.events.onError((error) => {
            console.error('Session error:', error);
            if (error.message.includes('permission_error')) {
                session.layouts.showTextWall(
                    'Location permission required!\n\n' +
                    'Please:\n' +
                    '1. Go to console.AugmentOS.org\n' +
                    '2. Select your app\n' +
                    '3. Add LOCATION permission\n' +
                    '4. Restart the app',
                    { view: ViewType.MAIN, durationMs: 5000 }
                );
            } else {
                session.layouts.showTextWall(
                    'Error occurred. Please check:\n' +
                    '1. Location services are enabled\n' +
                    '2. You have a clear view of the sky\n' +
                    '3. Try restarting the app',
                    { view: ViewType.MAIN, durationMs: 5000 }
                );
            }
        });

        session.events.onDisconnected(() => {
            console.log(`Session ${sessionId} disconnected.`);
            this.cleanupSession(sessionId);
        });
    }
    
    /**
     * This method is called by the Mentra Cloud when a session is requested to stop,
     * for example, if the user manually stops the app from their phone.
     */
    protected override async onStop(sessionId: string, userId: string, reason: string = 'unknown'): Promise<void> {
        console.log(`Received stop request for session ${sessionId}`);
        const run = this.activeRuns.get(sessionId);
        if (run) {
            run.stop();
            console.log('Final stats:', run.getStats());
        }
        this.cleanupSession(sessionId);
        await super.onStop(sessionId, userId, reason);
    }

    /**
     * A helper method to clean up all data associated with a session when it ends.
     */
    private cleanupSession(sessionId: string) {
        const run = this.activeRuns.get(sessionId);
        if (run) {
            run.stop(); // Ensure all timers are stopped
        }
        this.activeRuns.delete(sessionId);
        const userId = this.sessionIdToUserId.get(sessionId);
        if (userId) {
            this.userIdToSessionId.delete(userId);
            this.sessionIdToUserId.delete(sessionId);
        }
    }
}

// Create and start the app server
const server = new MyMentraApp({
    packageName: PACKAGE_NAME,
    apiKey: AUGMENTOS_API_KEY,
    port: PORT,
});

server.start().catch(err => {
    console.error("Failed to start server:", err);
});