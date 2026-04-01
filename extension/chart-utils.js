/**
 * chart-utils.js — SVG Chart Rendering Utilities
 * v0.5.5: Bezier curves, gradient fills, and interactive hover features
 * 
 * Provides tools for rendering professional-grade climb profile charts with:
 * - Cubic bezier curve smoothing
 * - Linear gradient fills (color-faded to bottom)
 * - Vertical auto-scaling for max visual clarity
 * - Hover scanner with real-time coordinates
 */

/**
 * Generate SVG gradient definitions for climb profile fills
 * Creates smooth color-to-transparent gradients matching the climb difficulty
 * 
 * @param {string} category - Climb category (HC, 1, 2, 3, 4)
 * @returns {Object} - { gradientId, startColor, endColor }
 */
function getGradientForCategory(category) {
  const gradients = {
    'HC': { id: 'grad-hc',    start: '#d42b2b', end: '#d42b2b33' },  // Red
    '1':  { id: 'grad-cat1',  start: '#e85d17', end: '#e85d1733' },  // Orange
    '2':  { id: 'grad-cat2',  start: '#e8a117', end: '#e8a11733' },  // Gold
    '3':  { id: 'grad-cat3',  start: '#c8c022', end: '#c8c02233' },  // Yellow
    '4':  { id: 'grad-cat4',  start: '#6b7280', end: '#6b728033' }   // Gray
  };
  
  return gradients[category] || gradients['4'];
}

/**
 * Calculate SVG gradient stop percentages and colors
 * Linear fade from top color to semi-transparent bottom
 * 
 * @param {string} topColor - Hex color at top (e.g. '#e85d17')
 * @returns {Array} - Array of { offset, stopColor } objects
 */
function generateGradientStops(topColor) {
  // Add alpha transparency (last 2 hex digits)
  const bottomColor = topColor + '33'; // 20% opacity
  
  return [
    { offset: '0%',   stopColor: topColor },
    { offset: '70%',  stopColor: topColor + 'cc' },    // 80% opacity
    { offset: '100%', stopColor: bottomColor }         // 20% opacity
  ];
}

/**
 * Generate cubic bezier curve control points from elevation segments
 * Creates smooth "professional" curve instead of jagged step profile
 * 
 * @param {Array} segments - Climb segments with distance/elevation data
 * @param {number} minElev - Minimum elevation for Y-axis
 * @param {number} maxElev - Maximum elevation for Y-axis
 * @param {number} width - SVG canvas width
 * @param {number} height - SVG canvas height
 * @returns {string} - SVG path data (d attribute)
 */
function generateBezierPath(segments, minElev, maxElev, width, height) {
  if (!segments || segments.length === 0) return '';

  const totalDist = segments.reduce((sum, s) => sum + s.distance, 0);
  const elevRange = maxElev - minElev;
  
  // Convert segment data to canvas coordinate points
  const points = [];
  let cumulativeDist = 0;

  for (const seg of segments) {
    const x = (cumulativeDist / totalDist) * width;
    const y = height - ((seg.endElevation - minElev) / elevRange) * height;
    
    points.push({ x, y, elevation: seg.endElevation, distance: cumulativeDist });
    cumulativeDist += seg.distance;
  }

  if (points.length < 2) {
    return `L ${points[0].x} ${points[0].y}`;
  }

  // Generate cubic bezier path
  let pathData = `M ${points[0].x} ${height}`; // Start at bottom-left
  pathData += ` L ${points[0].x} ${points[0].y}`; // Vertical line to first point

  // Cubic bezier through each point
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    // Calculate control points for smooth bezier
    const cp1x = prev.x + (curr.x - prev.x) * 0.5;
    const cp1y = prev.y;
    const cp2x = curr.x - (next ? (next.x - curr.x) * 0.5 : 0);
    const cp2y = curr.y;

    pathData += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${curr.x} ${curr.y}`;
  }

  // Close path back down
  const lastPoint = points[points.length - 1];
  pathData += ` L ${lastPoint.x} ${height} Z`;

  return pathData;
}

/**
 * Calculate optimal Y-axis min/max for maximum vertical resolution
 * Instead of using 0-max, scale to climb_min - 5m to climb_max
 * 
 * @param {Array} segments - Climb segments
 * @returns {Object} - { minElev, maxElev, range }
 */
function calculateOptimalYScale(segments) {
  if (!segments || segments.length === 0) {
    return { minElev: 0, maxElev: 100, range: 100 };
  }

  let minElev = Math.min(...segments.map(s => Math.min(s.startElevation, s.endElevation)));
  let maxElev = Math.max(...segments.map(s => Math.max(s.startElevation, s.endElevation)));

  // Reduce min by 5m for padding, add 10m padding to max
  minElev = Math.max(0, minElev - 5);
  maxElev = maxElev + 10;

  return {
    minElev,
    maxElev,
    range: maxElev - minElev
  };
}

/**
 * Find the segment and exact position at a given horizontal pixel coordinate
 * Used for hover scanner to show real-time grade/distance
 * 
 * @param {Array} segments - Climb segments
 * @param {number} pixelX - X coordinate in SVG canvas
 * @param {number} totalDist - Total route distance
 * @param {number} canvasWidth - SVG canvas width
 * @returns {Object} - { segment, distance, elevation, grade, pixelY, found }
 */
function findSegmentAtPixel(segments, pixelX, totalDist, canvasWidth) {
  if (!segments || segments.length === 0) {
    return { found: false };
  }

  // Convert pixel position to route distance
  const queryDistance = (pixelX / canvasWidth) * totalDist;

  let currentDistance = 0;
  
  for (const seg of segments) {
    const segStartDist = currentDistance;
    const segEndDist = currentDistance + seg.distance;

    if (queryDistance >= segStartDist && queryDistance <= segEndDist) {
      // Found the segment
      const progress = (queryDistance - segStartDist) / seg.distance; // 0 to 1

      // Interpolate elevation at this point
      const interpElev = seg.startElevation + (seg.endElevation - seg.startElevation) * progress;
      const interpGrade = seg.gradient;

      return {
        found: true,
        segment: seg,
        distance: queryDistance,
        elevation: interpElev,
        grade: interpGrade,
        progress,
        segmentIndex: segments.indexOf(seg)
      };
    }

    currentDistance = segEndDist;
  }

  return { found: false };
}

/**
 * Format elevation/grade values for hover tooltip display
 * 
 * @param {number} elevation - Elevation in meters
 * @param {number} grade - Gradient percentage
 * @param {number} distance - Distance from climb start in meters
 * @returns {Object} - Formatted strings: { elevStr, gradeStr, distStr }
 */
function formatHoverValues(elevation, grade, distance) {
  return {
    elevStr: `${Math.round(elevation)}m`,
    gradeStr: `${Math.min(25, Math.max(0, grade)).toFixed(1)}%`, // Cap at 25% display
    distStr: `${(distance / 1000).toFixed(2)}km`
  };
}

/**
 * Generate SVG defs section with all gradients needed
 * Must be inserted once at top of SVG element
 * 
 * @returns {string} - SVG defs XML string
 */
function generateSVGDefs() {
  const categories = ['HC', '1', '2', '3', '4'];
  let defs = '<defs>';

  for (const cat of categories) {
    const gradient = getGradientForCategory(cat);
    const stops = generateGradientStops(gradient.start);

    defs += `
    <linearGradient id="${gradient.id}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:${gradient.start};stop-opacity:1" />
      <stop offset="70%" style="stop-color:${gradient.start};stop-opacity:0.8" />
      <stop offset="100%" style="stop-color:${gradient.start};stop-opacity:0.2" />
    </linearGradient>`;
  }

  defs += '</defs>';
  return defs;
}
