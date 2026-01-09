const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const multer = require('multer');
const cors = require('cors');

const app = express();
const upload = multer();

// Enable CORS for all routes
app.use(cors());

// Proxy endpoint
app.post('/api/fullcam', upload.single('file'), async (req, res) => {
    console.log('\n=== PROXY REQUEST RECEIVED ===');
    console.log('Headers:', req.headers);
    console.log('File info:', req.file ? `${req.file.originalname} (${req.file.size} bytes)` : 'NO FILE');
    
    try {
        const apiKey = req.headers['ocp-apim-subscription-key'];
        
        if (!apiKey) {
            console.error('❌ Missing API key');
            return res.status(400).json({ error: 'Missing API key header: Ocp-Apim-Subscription-Key' });
        }

        if (!req.file) {
            console.error('❌ No file uploaded');
            return res.status(400).json({ error: 'No file uploaded' });
        }

        console.log('✓ Proxying request:', {
            filename: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype,
            apiKey: apiKey.substring(0, 8) + '...'
        });

        // Create FormData for the API request
        const form = new FormData();
        form.append('file', req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype
        });

        // Forward to the actual API
        const apiUrl = 'https://api.climatechange.gov.au/climate/carbon-accounting/2024/plot/v1/2024/fullcam-simulator/run-plotsimulation';
        
        console.log('📤 Sending to API:', apiUrl);
        console.log('Form headers:', form.getHeaders());
        
        const response = await axios.post(apiUrl, form, {
            headers: {
                ...form.getHeaders(),
                'Ocp-Apim-Subscription-Key': apiKey
            },
            responseType: 'text',
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        console.log('📥 API Response received:');
        console.log('  Status:', response.status);
        console.log('  Headers:', response.headers);
        console.log('  Data length:', response.data ? response.data.length : 0);

        // Forward the response headers
        if (response.headers['content-disposition']) {
            console.log('  ✓ Setting Content-Disposition:', response.headers['content-disposition']);
            res.setHeader('Content-Disposition', response.headers['content-disposition']);
        }
        if (response.headers['content-type']) {
            console.log('  ✓ Setting Content-Type:', response.headers['content-type']);
            res.setHeader('Content-Type', response.headers['content-type']);
        }

        // Send the response data
        res.status(response.status).send(response.data);
        
        console.log('✓ Response forwarded to browser:', response.data.length, 'bytes');

    } catch (error) {
        console.error('\n❌ PROXY ERROR:');
        console.error('Message:', error.message);
        console.error('Response status:', error.response?.status);
        console.error('Response data:', error.response?.data);
        console.error('Stack:', error.stack);
        
        res.status(error.response?.status || 500).json({
            error: error.message,
            status: error.response?.status,
            details: error.response?.data,
            proxyNote: 'Error occurred in proxy server while forwarding to API'
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'FullCAM API Proxy Server' });
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`\n🚀 FullCAM API Proxy Server running on http://localhost:${PORT}`);
    console.log(`📡 Proxy endpoint: http://localhost:${PORT}/api/fullcam`);
    console.log(`💡 Use this URL in your browser app to avoid CORS issues\n`);
});
