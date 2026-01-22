import './style.scss';
import { initializeMap } from './map';
import { testRainfallCalculation } from './weather';
import { updateSpatialData } from './spatial-data-updater';

// Initialize the map when the page loads
initializeMap();

// Run rainfall test
testRainfallCalculation();

// Example: Update spatial data for a site location
async function handleSpatialDataUpdate(lat: number, lng: number, strtYear: number, endYear: number, plantingDate: number, plantingName: string) {
  console.log('Updating spatial data for coordinates:', lat, lng);

  const result = await updateSpatialData(lat, lng, strtYear, endYear, plantingDate, plantingName);

  if (result.success) {
    console.log('Spatial data updated successfully');
    console.log('Response:', result.data);
  } else {
    console.error('Spatial data update failed:', result.error);
  }
}

// Export for use in other modules
export { handleSpatialDataUpdate };
