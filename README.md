# Nandani Wedding Gallery — Railway Ready

Wedding photos और long videos के लिए responsive gallery website.

## Features
- Wedding name + album
- Photo upload
- Long video upload
- 8 MB chunked uploads
- Upload progress
- Browser video playback
- Download
- Delete
- Mobile responsive design
- Application-level 20 GB single-file limit
- Persistent storage support via `STORAGE_ROOT`

## Railway deployment

### 1. GitHub
ZIP को extract करके पूरा project एक GitHub repository में upload करें.

### 2. Railway
Railway में **New Project → Deploy from GitHub Repo** चुनें और repository select करें.

### 3. Domain
Deployment के बाद **Settings → Networking → Generate Domain** करें.

### 4. Persistent Volume — जरूरी
Railway में service खोलें:
**Volumes → Add Volume**

Mount path रखें:
`/app/storage`

Environment variable जोड़ें:
`STORAGE_ROOT=/app/storage`

इससे uploaded photos/videos और album database persistent storage में रहेंगे.

### 5. बड़े वीडियो
20 GB application limit है, लेकिन वास्तविक सीमा Volume size, hosting plan, bandwidth और proxy limits पर निर्भर करेगी.
यदि 20 GB तक files रखनी हैं तो Volume को पर्याप्त बड़ा रखें.

## Important
यह version local filesystem/Volume पर files रखता है. बहुत बड़ी wedding libraries के लिए production में S3-compatible object storage (जैसे Cloudflare R2, AWS S3 आदि) बेहतर और scalable विकल्प है.

## Local run
Node.js 18+:
1. `npm install`
2. `npm start`
3. `http://localhost:3000`

Default local storage: `./storage/`
