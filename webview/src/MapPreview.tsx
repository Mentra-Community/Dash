import React from 'react';

interface MapPreviewProps {
  path: Array<{ lat: number; lng: number }>;
  onClick: () => void;
}

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
  mapUrl.searchParams.append('maptype', 'terrain');
  mapUrl.searchParams.append('path', `weight:5|color:0x28a745FF|enc:${encodedPath}`);
  mapUrl.searchParams.append('key', apiKey);

  return (
    <div className="map-preview-container" onClick={onClick}>
      <img src={mapUrl.toString()} alt="Map of your run" style={{ width: '100%', height: 'auto', borderRadius: '12px', cursor: 'pointer' }} />
    </div>
  );
};

export default MapPreview; 