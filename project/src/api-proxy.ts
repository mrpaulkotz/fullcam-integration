/**
 * Backend proxy for FullCAM API to avoid CORS issues
 */
import express from 'express';
import type { Request, Response } from 'express';
import FormData from 'form-data';
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

interface SubmitPlotRequest {
  plotContent: string;
  filename?: string;
  subscriptionKey?: string;
}

app.post('/api/submit-plot', async (req: Request<{}, {}, SubmitPlotRequest>, res: Response) => {
  try {
    const { plotContent, filename, subscriptionKey } = req.body;
    
    console.log('=== Proxy Request Received ===');
    console.log('Filename:', filename);
    console.log('Has subscription key:', !!subscriptionKey);
    console.log('Content length:', plotContent?.length);
    
    if (!plotContent) {
      res.status(400).json({
        success: false,
        error: 'Plot content is required',
      });
      return;
    }
    
    const formData = new FormData();
    formData.append('file', Buffer.from(plotContent), {
      filename: filename || 'plot.plo',
      contentType: 'application/xml',
    });
    
    const headers: Record<string, string> = {
      ...formData.getHeaders()
    };
    
    if (subscriptionKey) {
      headers['Ocp-Apim-Subscription-Key'] = subscriptionKey;
      console.log('Added Ocp-Apim-Subscription-Key header');
    } else {
      console.warn('WARNING: No subscription key provided - API may reject request');
    }
    
    console.log('Request headers:', Object.keys(headers));
    console.log('Submitting to FullCAM API...');
    
    const response = await fetch(
      'https://api.climatechange.gov.au/climate/carbon-accounting/2024/plot/v1/2024/fullcam-simulator/run-plotsimulation',
      {
        method: 'POST',
        headers: headers,
        body: formData as any,
      }
    );
    
    console.log('API Response Status:', response.status);
    const contentType = response.headers.get('content-type');
    console.log('Content-Type:', contentType);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error Response:', errorText);
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }
    
    if (contentType?.includes('text/csv') || contentType?.includes('text/plain')) {
      const csvData = await response.text();
      console.log('API Success (CSV):', csvData.substring(0, 200) + '...');
      res.json({ 
        success: true, 
        data: csvData,
        dataType: 'csv',
        contentType: contentType
      });
    } else {
      const data = await response.json();
      console.log('API Success (JSON):', data);
      res.json({ success: true, data, dataType: 'json' });
    }
  } catch (error) {
    console.error('=== Proxy Error ===');
    console.error(error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.post('/api/update-spatial', async (req: Request<{}, {}, SubmitPlotRequest>, res: Response) => {
  try {
    const { plotContent, filename, subscriptionKey } = req.body;
    
    console.log('=== Spatial Data Update Request ===');
    console.log('Filename:', filename);
    console.log('Subscription key received:', !!subscriptionKey);
    console.log('Subscription key length:', subscriptionKey?.length || 0);
    console.log('Content length:', plotContent?.length);
    
    if (!plotContent) {
      res.status(400).json({
        success: false,
        error: 'Plot content is required',
      });
      return;
    }
    
    if (!subscriptionKey || subscriptionKey.trim() === '') {
      console.error('ERROR: No subscription key provided');
      res.status(400).json({
        success: false,
        error: 'Subscription key is required for spatial data updates',
      });
      return;
    }
    
    const formData = new FormData();
    formData.append('file', Buffer.from(plotContent), {
      filename: filename || 'siteForSpatialUpdate.plo',
      contentType: 'application/xml',
    });
    
    const headers: Record<string, string> = {
      ...formData.getHeaders(),
      'Ocp-Apim-Subscription-Key': subscriptionKey.trim()
    };
    
    console.log('Request headers:', Object.keys(headers));
    console.log('Ocp-Apim-Subscription-Key header set with length:', headers['Ocp-Apim-Subscription-Key']?.length || 0);
    console.log('Submitting to Spatial Data API...');
    
    const response = await fetch(
      'https://api.climatechange.gov.au/climate/carbon-accounting/2024/data/v1/2024/data-builder/update-spatialdata',
      {
        method: 'POST',
        headers: headers,
        body: formData as any,
      }
    );
    
    console.log('API Response Status:', response.status);
    console.log('API Response Headers:', Object.fromEntries(response.headers.entries()));
    const contentType = response.headers.get('content-type');
    console.log('Content-Type:', contentType);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error Response:', errorText);
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }
    
    if (contentType?.includes('application/xml') || contentType?.includes('text/xml')) {
      const xmlData = await response.text();
      console.log('Spatial Data API Success (XML):', xmlData.substring(0, 200) + '...');
      res.json({ 
        success: true, 
        data: xmlData,
        dataType: 'xml',
        contentType: contentType
      });
    } else if (contentType?.includes('text/plain')) {
      const textData = await response.text();
      console.log('Spatial Data API Success (Text):', textData.substring(0, 200) + '...');
      res.json({ 
        success: true, 
        data: textData,
        dataType: 'text',
        contentType: contentType
      });
    } else {
      const responseBody = await response.text();

      try {
        const data = JSON.parse(responseBody);
        console.log('Spatial Data API Success (JSON):', data);
        res.json({ success: true, data, dataType: 'json' });
      } catch (jsonError) {
        console.log('Spatial Data API Success (fallback to text):', responseBody.substring(0, 200) + '...');
        res.json({ 
          success: true, 
          data: responseBody,
          dataType: 'text',
          contentType: contentType
        });
      }
    }
  } catch (error) {
    console.error('=== Spatial Data Update Error ===');
    console.error(error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.post('/api/run-simulation', async (req: Request<{}, {}, SubmitPlotRequest>, res: Response) => {
  const { plotContent, filename, subscriptionKey } = req.body;

  if (!plotContent || !subscriptionKey) {
    res.status(400).json({ 
      success: false, 
      error: 'plotContent and subscriptionKey are required' 
    });
    return;
  }

  const plotFilename = filename || 'plantingPlotfileForSimulation.plo';

  try {
    console.log('=== Running Plot Simulation ===');
    console.log('Filename:', plotFilename);
    console.log('Subscription key length:', subscriptionKey.length);

    const form = new FormData();
    const buffer = Buffer.from(plotContent, 'utf-8');
    form.append('file', buffer, {
      filename: plotFilename,
      contentType: 'application/octet-stream'
    });

    const apiUrl = 'https://api.climatechange.gov.au/climate/carbon-accounting/2024/plot/v1/2024/fullcam-simulator/run-plotsimulation';

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': subscriptionKey,
        ...form.getHeaders()
      },
      body: form as any
    });

    const responseText = await response.text();
    console.log('Simulation API response status:', response.status);
    console.log('Simulation API response:', responseText.substring(0, 500));

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${responseText}`);
    }

    res.json({
      success: true,
      data: responseText
    });

  } catch (error) {
    console.error('Simulation error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', port: PORT });
});

// Start server AFTER all routes are defined
app.listen(PORT, () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Proxy server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`${'='.repeat(50)}\n`);
});