import { GoogleMap, Marker, Polyline, useJsApiLoader } from '@react-google-maps/api';
import { useState, useEffect, useRef } from 'react';

const containerStyle = {
  width: '100%',
  height: '100%'
};

const mapOptions = {
  disableDefaultUI: true,
  zoomControl: false,
  mapTypeId: 'terrain',
  styles: [
    { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
    { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
    { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#263c3f" }] },
    { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#6b9a76" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
    { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1f2835" }] },
    { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#f3d19c" }] },
    { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
    { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
    { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#17263c" }] },
  ]
};

const polylineOptions = {
  strokeColor: '#28a745', // Brand green for the path
  strokeOpacity: 0.8,
  strokeWeight: 6,
  fillColor: '#28a745',
  fillOpacity: 0.35,
};

interface MapContainerProps {
  path: Array<{ lat: number; lng: number }>;
  isCentered: boolean;
  onCenterChange: () => void;
}

function MapContainer({ path, isCentered, onCenterChange }: MapContainerProps) {
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  });

  const [center, setCenter] = useState({ lat: 0, lng: 0 });
  const mapRef = useRef<google.maps.Map | null>(null);

  useEffect(() => {
    if (path.length > 0) {
      const newCenter = path[path.length - 1];
      if (newCenter) {
        if (isCentered) {
          setCenter(newCenter);
          mapRef.current?.panTo(newCenter);
        }
      }
    }
  }, [path, isCentered]);

  if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY) {
    return <div>Google Maps API Key is missing.</div>;
  }

  if (!isLoaded) return <div>Loading Map...</div>;

  const currentPosition = path.length > 0 ? path[path.length - 1] : undefined;

  return (
    <GoogleMap
      mapContainerStyle={containerStyle}
      center={center}
      zoom={16}
      options={mapOptions}
      onLoad={(map) => {
        mapRef.current = map;
        if (path.length > 0) {
          const initialCenter = path[path.length - 1];
          if (initialCenter) setCenter(initialCenter);
        }
      }}
      onDragStart={onCenterChange}
    >
      {currentPosition && (
        <Marker
          position={currentPosition}
          icon={{
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#28a745",
            fillOpacity: 1,
            strokeWeight: 2,
            strokeColor: "white"
          }}
        />
      )}
      {path.length > 1 && (
        <Polyline
          path={path}
          options={polylineOptions}
        />
      )}
    </GoogleMap>
  );
}

export default MapContainer; 