// Local MongoDB for development without installing MongoDB: a single-node replica set (needed for
// transactions) with data kept in .mongo-data/. Leave it running, and set in .env.local:
//   MONGODB_URI=mongodb://127.0.0.1:27017/chefs_academy?replicaSet=rs0
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { mkdirSync } from 'node:fs'

mkdirSync('.mongo-data', { recursive: true })
const replSet = await MongoMemoryReplSet.create({
  replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
  instanceOpts: [{ port: 27017, dbPath: '.mongo-data', storageEngine: 'wiredTiger' }],
})
console.log(`MongoDB running: ${replSet.getUri('chefs_academy')}`)
console.log('Press Ctrl+C to stop.')
const stop = async () => {
  await replSet.stop({ doCleanup: false })
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
