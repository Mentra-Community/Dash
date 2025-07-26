import React from 'react';

interface MapPreviewProps {
  path: Array<{ lat: number; lng: number }>;
  onClick: () => void;
}

// These styles are copied from MapContainer.tsx to ensure a consistent look
const mapStyles = [
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
];

const MapPreview: React.FC<MapPreviewProps> = ({ path, onClick }) => {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  if (!apiKey) return null; // Don't render if no key

  // Create the encoded polyline for the URL
  const encodeCoord = (coord: number) => {
    let V = Math.round(coord * 1e5);
    V = V < 0 ? ~(V << 1) : V << 1;
    let S = '';
    while (V >= 0x20) {
      S += String.fromCharCode((0x20 | (V & 0x1f)) + 63);
      V >>= 5;
    }
    S += String.fromCharCode(V + 63);
    return S;
  };
  
  let lastLat = 0, lastLng = 0;
  const encodedPath = path.map(point => {
    const lat = point.lat;
    const lng = point.lng;
    const dLat = lat - lastLat;
    const dLng = lng - lastLng;
    lastLat = lat;
    lastLng = lng;
    return encodeCoord(dLat) + encodeCoord(dLng);
  }).join('');


  // Create the URL for the Static Map API
  const mapUrl = new URL('https://maps.googleapis.com/maps/api/staticmap');
  mapUrl.searchParams.append('size', '600x300');
  mapUrl.searchParams.append('maptype', 'roadmap'); // Use roadmap with styles, not terrain
  mapUrl.searchParams.append('path', `weight:5|color:0x28a745FF|enc:${encodedPath}`);

  // Convert JSON styles to URL parameters for the static map
  mapStyles.forEach(style => {
    const styleParts: string[] = [];
    if (style.featureType) {
      styleParts.push(`feature:${style.featureType}`);
    }
    if (style.elementType) {
      styleParts.push(`element:${style.elementType}`);
    }
    style.stylers.forEach(styler => {
      const key = Object.keys(styler)[0];
      const value = (styler as any)[key].replace('#', '0x');
      styleParts.push(`${key}:${value}`);
    });
    mapUrl.searchParams.append('style', styleParts.join('|'));
  });

  mapUrl.searchParams.append('key', apiKey);

  return (
    <div className="map-preview-container" onClick={onClick}>
      <img src={mapUrl.toString()} alt="Map of your run" style={{ width: '100%', height: 'auto', borderRadius: '12px', cursor: 'pointer' }} />
    </div>
  );
};

export default MapPreview; 