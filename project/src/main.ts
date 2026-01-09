import './style.scss';
import { initializeMap } from './map';
import { testRainfallCalculation } from './weather';

// Initialize the map when the page loads
initializeMap();

// Run rainfall test
testRainfallCalculation();
