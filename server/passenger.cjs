// Startup file for cPanel "Setup Node.js App" (Phusion Passenger). Passenger loads startup files with
// require(), and this API is an ES module, so this CommonJS file loads it with a dynamic import.
// Passenger takes over app.listen(), so the PORT setting is ignored here.
import('./src/index.js').catch((err) => {
  console.error('Failed to start the API', err)
  process.exit(1)
})
