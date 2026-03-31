/**
 * GPX Parser for Climb Analyzer
 * Parses GPX XML files and extracts elevation profile data
 */

/**
 * Parse GPX file and extract elevation profile
 * @param {string} gpxContent - The GPX XML content as string
 * @returns {Array} Elevation profile: [[cumulative_distance, elevation], ...]
 */
function parseGPX(gpxContent) {
  console.log('[GPX Parser] Parsing GPX file...');
  
  try {
    const parser = new DOMParser();
    const gpxDoc = parser.parseFromString(gpxContent, 'text/xml');
    
    if (gpxDoc.getElementsByTagName('parsererror').length > 0) {
      throw new Error('Invalid XML in GPX file');
    }

    // Extract track points
    const trackPoints = [];
    
    // Try multiple namespaces for GPX
    const namespaces = [
      'http://www.topografix.com/GPX/1/1',
      'http://www.topografix.com/GPX/1/0',
      ''
    ];

    let trkpts = [];
    for (const ns of namespaces) {
      if (ns) {
        trkpts = gpxDoc.getElementsByTagNameNS(ns, 'trkpt');
      } else {
        trkpts = gpxDoc.getElementsByTagName('trkpt');
      }
      if (trkpts.length > 0) break;
    }

    console.log(`[GPX Parser] Found ${trkpts.length} track points`);

    // Extract coordinates and elevation
    for (let i = 0; i < trkpts.length; i++) {
      const trkpt = trkpts[i];
      const lat = parseFloat(trkpt.getAttribute('lat'));
      const lon = parseFloat(trkpt.getAttribute('lon'));
      
      // Find elevation in different possible locations
      let ele = null;
      let eleElement = trkpt.getElementsByTagName('ele')[0];
      if (!eleElement) {
        eleElement = trkpt.getElementsByTagNameNS('http://www.topografix.com/GPX/1/1', 'ele')[0];
      }
      if (eleElement) {
        ele = parseFloat(eleElement.textContent);
      }

      if (!isNaN(lat) && !isNaN(lon)) {
        trackPoints.push({
          lat: lat,
          lon: lon,
          ele: ele || 0,
          index: i
        });
      }
    }

    if (trackPoints.length === 0) {
      throw new Error('No track points found in GPX file');
    }

    console.log(`[GPX Parser] Extracted ${trackPoints.length} track points with coordinates`);

    // Calculate cumulative distance and build elevation profile
    const elevationProfile = [];
    let cumulativeDistance = 0;

    for (let i = 0; i < trackPoints.length; i++) {
      const point = trackPoints[i];
      
      if (i > 0) {
        const prevPoint = trackPoints[i - 1];
        const distance = haversineDistance(
          prevPoint.lat,
          prevPoint.lon,
          point.lat,
          point.lon
        );
        cumulativeDistance += distance;
      }

      elevationProfile.push([
        cumulativeDistance,
        point.ele,
        point.lat,
        point.lon
      ]);
    }

    console.log(`[GPX Parser] Built elevation profile with ${elevationProfile.length} points`);
    console.log(`[GPX Parser] Total distance: ${(cumulativeDistance / 1000).toFixed(2)} km`);
    console.log(`[GPX Parser] Elevation range: ${Math.min(...elevationProfile.map(ep => ep[1])).toFixed(0)}m - ${Math.max(...elevationProfile.map(ep => ep[1])).toFixed(0)}m`);

    return elevationProfile;
  } catch (error) {
    console.error('[GPX Parser] Error parsing GPX:', error);
    throw error;
  }
}

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of point 1 (degrees)
 * @param {number} lon1 - Longitude of point 1 (degrees)
 * @param {number} lat2 - Latitude of point 2 (degrees)
 * @param {number} lon2 - Longitude of point 2 (degrees)
 * @returns {number} Distance in meters
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Convert degrees to radians
 */
function toRad(degrees) {
  return degrees * Math.PI / 180;
}

/**
 * Load and parse GPX file from File object
 * @param {File} file - The GPX file
 * @returns {Promise<Array>} Elevation profile array
 */
function loadGPXFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const gpxContent = e.target.result;
        const elevationProfile = parseGPX(gpxContent);
        resolve(elevationProfile);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsText(file);
  });
}
