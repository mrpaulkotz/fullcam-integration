const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const url = "https://api.climatechange.gov.au/climate/carbon-accounting/2024/plot/v1/2024/fullcam-simulator/run-plotsimulation";

const form = new FormData();
form.append('file', fs.createReadStream('docs/ExampleEnvironmentalPlanting.plo'));

axios.post(url, form, {
    headers: {
        ...form.getHeaders(),
        'Ocp-Apim-Subscription-Key': 'c7ce17dce569418b8d3bf7f5a3cd14d3'
    },
    responseType: 'text',  // Important: ensure text response
    maxContentLength: Infinity,
    maxBodyLength: Infinity
})
    .then(response => {
        console.log('='.repeat(50));
        console.log('Status Code:', response.status);
        console.log('Content-Type:', response.headers['content-type']);
        console.log('Content-Length:', response.headers['content-length']);
        console.log('Content-Disposition:', response.headers['content-disposition']);
        console.log('Response Data Type:', typeof response.data);
        console.log('Response Data Length:', response.data ? response.data.length : 0);
        console.log('='.repeat(50));
        console.log('Response Headers:');
        console.log(response.headers);
        console.log('='.repeat(50));
        console.log('Response Body Preview (first 500 chars):');
        console.log(response.data ? response.data.substring(0, 500) : '[EMPTY]');
        console.log('='.repeat(50));
        
        // Save to file if we got data
        if (response.data && response.data.length > 0) {
            fs.writeFileSync('test-response.csv', response.data);
            console.log('✓ Response saved to test-response.csv');
        }
    })
    .catch(error => {
        console.error('Error:', error.response ? error.response.data : error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Headers:', error.response.headers);
        }
    });
