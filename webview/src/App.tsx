import { useAugmentosAuth } from '@augmentos/react';
import { useState, useEffect } from 'react';
import './App.css';
import MapContainer from './MapContainer';
import { MapIcon, RecenterIcon } from './Icons';
import MapPreview from './MapPreview';

// Type definition for the run statistics
interface RunStats {
  totalDistance: number;
  activeTime: number;
  averagePace: number;
  runStatus: 'running' | 'stopped';
  rollingPace: number;
  isValidActivity: boolean;
  activityType: 'running' | 'cycling' | null;
  locationHistory: Array<{ lat: number; lng: number }>;
}

function App() {
  const { userId, frontendToken, isAuthenticated, isLoading } = useAugmentosAuth();
  const [runStatus, setRunStatus] = useState<'stopped' | 'running' | 'loading'>('loading');
  const [activityType, setActivityType] = useState<'running' | 'cycling' | null>(null);
  const [finalStats, setFinalStats] = useState<RunStats | null>(null);
  const [locationHistory, setLocationHistory] = useState<Array<{ lat: number; lng: number }>>([]);
  const [isMapVisible, setMapVisible] = useState(false);
  const [isMapCentered, setMapCentered] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Helper to format time from milliseconds to MM:SS
  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Helper to format pace from minutes per mile to MM:SS /mi
  const formatPace = (pace: number) => {
    if (pace === 0) return '--:-- /mi';
    const minutes = Math.floor(pace);
    const seconds = Math.round((pace - minutes) * 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')} /mi`;
  };

  // Helper to format speed from pace (min/mi) to MPH
  const formatSpeed = (pace: number) => {
    if (pace === 0) return '0.0 mph';
    const mph = 60 / pace;
    return `${mph.toFixed(1)} mph`;
  };

  // Function to make authenticated API requests
  const apiRequest = async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    if (!frontendToken) {
      throw new Error('Authentication token not available.');
    }
    const response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        ...options.headers,
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${frontendToken}`,
      },
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error((err as any).error || 'API request failed');
    }
    return response.json() as Promise<T>;
  };

  // Fetch initial run status and poll for updates
  useEffect(() => {
    if (isAuthenticated && frontendToken) {
      // Poll for stats to sync status and location history
      const pollStats = () => {
        if (runStatus === 'running') {
          apiRequest<RunStats>('/run/stats')
            .then((data) => {
              setLocationHistory(data.locationHistory); // Update path for the map
              if (data.runStatus === 'stopped') {
                setRunStatus('stopped');
                setFinalStats(data);
              }
            })
            .catch((err: any) => console.error('Failed to poll stats:', err));
        }
      };

      // Initial status check
      apiRequest<RunStats>('/run/stats')
        .then((data) => {
          setRunStatus(data.runStatus);
          setLocationHistory(data.locationHistory);
          setActivityType(data.activityType); // Sync activity type
        })
        .catch((err: any) => setError(err.message || 'Could not connect to the run tracker.'));
      
      const pollInterval = setInterval(pollStats, 3000);
      return () => clearInterval(pollInterval);
    }
  }, [isAuthenticated, frontendToken, runStatus]);

  const handleStartRun = async () => {
    setError(null);
    setFinalStats(null);
    setLocationHistory([]);
    setMapVisible(false);
    setMapCentered(true);
    try {
      await apiRequest('/run/start', {
        method: 'POST',
        body: JSON.stringify({ activityType }),
      });
      setRunStatus('running');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleStopRun = async () => {
    setError(null);
    try {
      const stats = await apiRequest<RunStats>('/run/stop', { method: 'POST' });
      setFinalStats(stats);
      setLocationHistory(stats.locationHistory);
      setRunStatus('stopped');
      setMapVisible(false); // Show stats page with preview first
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    return <div>Please open this from the AugmentOS app.</div>;
  }

  // Full screen map view
  if (isMapVisible) {
    return (
      <div className="map-view-container">
        <MapContainer 
          path={locationHistory}
          isCentered={isMapCentered}
          onCenterChange={() => setMapCentered(false)}
        />
        {!isMapCentered && (
          <button className="icon-button recenter-button" onClick={() => setMapCentered(true)}>
            <RecenterIcon />
          </button>
        )}
        <button className="close-map-button" onClick={() => setMapVisible(false)}>
          {runStatus === 'running' ? 'Hide Map' : 'Hide Map'}
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="top-content">
        <h1>MENTRA DASH</h1>
        <p className="read-the-docs">
          Welcome, user {userId?.split('-')[0]}
        </p>
      </div>

      {runStatus === 'running' && (
        <div className="in-progress-container">
          <p>Run in progress on your glasses...</p>
          <div className="pulsing-dot"></div>
        </div>
      )}

      {runStatus === 'stopped' && !finalStats && (
        <div className="start-button-container">
          {!activityType ? (
            <div className="activity-selector">
              <h2 className="activity-title">Select Activity</h2>
              <button onClick={() => setActivityType('running')} className="activity-select-button">
                Running
              </button>
              <button onClick={() => setActivityType('cycling')} className="activity-select-button">
                Cycling
              </button>
            </div>
          ) : (
            <div className="start-confirmation">
              <p className="ready-text">Ready to {activityType === 'running' ? 'Run' : 'Ride'}?</p>
              <button onClick={handleStartRun} className="start-run-button">START</button>
              <button onClick={() => setActivityType(null)} className="change-activity-button">
                Change Activity
              </button>
            </div>
          )}
        </div>
      )}
      
      {finalStats && runStatus === 'stopped' && (
        <div className="post-run-summary">
          {finalStats.isValidActivity ? (
            <>
              <MapPreview path={locationHistory} onClick={() => setMapVisible(true)} />
              <div className="stats-container">
                <h2>{finalStats.activityType === 'running' ? 'Run' : 'Ride'} Complete!</h2>
                <div className="stat"><strong>Distance:</strong> <span className="value">{finalStats.totalDistance.toFixed(2)} mi</span></div>
                <div className="stat"><strong>Moving Time:</strong> <span className="value">{formatTime(finalStats.activeTime)}</span></div>
                {finalStats.activityType === 'running' ? (
                  <div className="stat">
                    <strong>Average Pace:</strong> <span className="value">{formatPace(finalStats.averagePace)}</span>
                  </div>
                ) : (
                  <div className="stat">
                    <strong>Average Speed:</strong> <span className="value">{formatSpeed(finalStats.averagePace)}</span>
                  </div>
                )}
              </div>
              <button onClick={() => { setFinalStats(null); setActivityType(null); }} className="start-run-button post-run-button">
                NEW ACTIVITY
              </button>
            </>
          ) : (
            <div className="in-progress-container">
              <h2>Activity too short</h2>
              <p>Run longer to gather more data</p>
              <div className="start-button-container post-run">
                 <button onClick={() => { setFinalStats(null); setActivityType(null); }} className="start-run-button">START NEW ACTIVITY</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bottom-content">
        {runStatus !== 'running' && !finalStats && (
          <p className="read-the-docs" style={{ padding: '0 2em', textAlign: 'center', marginBottom: '1em' }}>
            Keep Mentra open if using Dash on iPhone. Fixing in next release
          </p>
        )}
        {error && <p className="error">Error: {error}</p>}
        
        {runStatus === 'running' && (
          <>
            <button className="icon-button map-button" onClick={() => setMapVisible(true)}>
              <MapIcon />
            </button>
            <button onClick={handleStopRun} className="end-run-button">End Run</button>
          </>
        )}
      </div>
    </div>
  )
}

export default App 