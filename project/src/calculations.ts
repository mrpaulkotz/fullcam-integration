import type { Coordinates } from './types';

/**
 * Calculate the area of a polygon in square meters using the Shoelace formula
 */
export function calculatePolygonArea(coordinates: number[][][]): number {
  const points = coordinates[0]; // Get the outer ring
  let area = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const [lng1, lat1] = points[i];
    const [lng2, lat2] = points[i + 1];

    // Convert to radians
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const lngDiff = (lng2 - lng1) * Math.PI / 180;

    // Calculate area using spherical excess
    area += lngDiff * (2 + Math.sin(lat1Rad) + Math.sin(lat2Rad));
  }

  // Earth's radius in meters
  const earthRadius = 6371000;
  area = Math.abs(area * earthRadius * earthRadius / 2);

  return area;
}

/**
 * Calculate the centroid of a polygon
 */
export function calculateCentroid(coordinates: number[][][]): Coordinates {
  const points = coordinates[0]; // Get the outer ring
  let sumLat = 0;
  let sumLng = 0;
  const numPoints = points.length - 1; // Exclude the closing point

  for (let i = 0; i < numPoints; i++) {
    sumLng += points[i][0];
    sumLat += points[i][1];
  }

  return {
    lng: sumLng / numPoints,
    lat: sumLat / numPoints
  };
}

/**
 * Calculate distance between two points in kilometers using Haversine formula
 */
export function calculateDistance(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
