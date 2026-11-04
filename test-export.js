const fetch = require('node-fetch');
async function test() {
  const res = await fetch('http://localhost:3000/api/readings/export');
  console.log('Status:', res.status);
  console.log('Content-Type:', res.headers.get('content-type'));
  const text = await res.text();
  console.log('Header:', text.split('\n')[0]);
}
test().catch(console.error);
