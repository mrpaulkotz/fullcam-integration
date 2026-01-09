/**
 * Climate Change API Client
 * API endpoint: https://api.climatechange.gov.au/climate/carbon-accounting/2024/plot/v1
 */

const API_BASE_URL = 'https://api.climatechange.gov.au/climate/carbon-accounting/2024/plot/v1';

export interface ClimateAPIConfig {
  subscriptionKey: string;
}

export interface ClimateAPIResponse {
  // Define response structure based on API documentation
  [key: string]: any;
}

/**
 * Send a request to the Climate Change API
 * @param subscriptionKey - The API subscription key
 * @param endpoint - Optional endpoint path to append to base URL
 * @param options - Additional fetch options
 * @returns Promise with the API response
 */
export async function fetchClimateData(
  subscriptionKey: string,
  endpoint: string = '',
  options: RequestInit = {}
): Promise<ClimateAPIResponse> {
  const url = endpoint ? `${API_BASE_URL}/${endpoint}` : API_BASE_URL;
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Ocp-Apim-Subscription-Key': subscriptionKey,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching climate data:', error);
    throw error;
  }
}

/**
 * Example usage function
 * @param subscriptionKey - Your API subscription key
 */
export async function exampleClimateAPICall(subscriptionKey: string): Promise<void> {
  try {
    console.log('Fetching climate data...');
    const data = await fetchClimateData(subscriptionKey);
    console.log('Climate data received:', data);
  } catch (error) {
    console.error('Failed to fetch climate data:', error);
  }
}
