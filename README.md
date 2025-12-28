# Document Store API README

This Node.js Express API powers a token-based document marketplace with M-Pesa payments, MongoDB storage, and JWT authentication. Users register, buy tokens via STK Push, and download educational documents from Google Drive.[1][2]

## Features

- User registration/login with JWT tokens (7-day expiry)
- M-Pesa STK Push integration for token purchases (30 KSH/token)
- Token-based document access (1 token per document)
- Download tracking and analytics
- Admin dashboard endpoints for sales data
- CORS enabled for Google Apps Script origin

## Prerequisites

- Node.js 18+ and npm
- MongoDB Atlas cluster (or self-hosted)
- M-Pesa Daraja API credentials (sandbox/production)
- Google Drive public file links for documents

## Quick Setup

1. Clone and install dependencies:
```
git clone <your-repo>
cd document-store-api
npm install
```

2. Create `.env` file:
```
MONGO_URI=mongodb uri
JWT_SECRET=your-super-secret-jwt-key
MPESA_CONSUMER_KEY=your_consumer_key
MPESA_CONSUMER_SECRET=your_consumer_secret
MPESA_SHORTCODE=your_shortcode
MPESA_PASSKEY=your_passkey
MPESA_CALLBACK_URL=https://yourdomain.com/api/mpesa/callback
MPESA_ENV=sandbox
BASE_URL=https://yourdomain.com
PORT=3000
```

3. Run the server:
```
npm start
```
Server starts on port 3000 with MongoDB auto-indexing.[3][4]

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | No | Create new user account |
| POST | `/api/auth/login` | No | User login with JWT |
| GET | `/api/user/profile` | Yes | Get user profile & tokens |
| POST | `/api/tokens/purchase` | Yes | Buy tokens via M-Pesa |
| GET | `/api/payment/status/:paymentId` | Yes | Check payment status |
| POST | `/api/document/download` | Yes | Request document download link |
| GET | `/api/documents` | No | List available documents |
| GET | `/api/user/downloads` | Yes | User download history |
| GET | `/api/analytics/sales` | Yes | Daily sales analytics |
| POST | `/api/mpesa/callback` | No | M-Pesa webhook (auto-configured) |
| GET | `/download/:token` | Token | Secure Google Drive redirect |

## M-Pesa Configuration

**Sandbox Testing:**
- Use Daraja sandbox credentials
- Test phone: 254708374149
- Expected flow: API → STK Push → Phone PIN → Callback → Tokens credited

**Production:**
```
MPESA_ENV=production
```
Update callback URL in Safaricom Daraja Portal.[4]

## Adding Documents

Edit `DOCUMENTS` object:
```javascript
'new-paper': {
  id: 'GOOGLE_DRIVE_FILE_ID',
  name: 'PAPER NAME.pdf',
  driveUrl: 'https://drive.google.com/uc?id=FILE_ID&export=download',
  tokensRequired: 1,
  category: 'Subject',
  year: '2024'
}
```
Make files publicly accessible in Google Drive.

## Deployment Options

**Recommended: Render.com (Free Tier)**
```
1. Push to GitHub
2. Connect Render → Web Service
3. Build: `npm install`
4. Start: `node server.js`
5. Add env vars in dashboard
```
Auto-deploys on git push.[5]

**Google Cloud Run:**
```
gcloud run deploy --source . --allow-unauthenticated
```
Scales to zero, handles M-Pesa webhooks.[2][1]

**Note:** Google Apps Script **cannot** run this Node.js server directly due to V8 runtime limitations (no npm modules, no persistent server). Use as client to call deployed API.[6][7]

## Database Schema

```
users: {email, password, fullName, phoneNumber, tokens, createdAt}
payments: {userId, amount, tokensPurchased, status, checkoutRequestId}
downloads: {userId, documentId, tokensUsed, createdAt, downloadedAt}
```

Indexes auto-created on startup for performance.

## Error Handling

- **401**: Missing/invalid JWT
- **402**: Insufficient tokens
- **400**: Validation errors
- **500**: Server errors logged to console

M-Pesa errors include detailed response codes and phone prompts.

## Security Features

- Passwords hashed with bcrypt
- JWT with 7-day expiry
- Rate-limited M-Pesa calls
- Download tokens expire in 1 hour
- Phone number validation (254XXXXXXXXX format)

## Testing

```bash
# Register
curl -X POST http://localhost:3000/api/auth/register \
-H "Content-Type: application/json" \
-d '{"email":"test@example.com","password":"pass123","fullName":"Test User","phoneNumber":"254712345678"}'

# Get token from response, then:
curl -X POST http://localhost:3000/api/tokens/purchase \
-H "Authorization: Bearer YOUR_JWT" \
-H "Content-Type: application/json" \
-d '{"numberOfTokens":5,"phoneNumber":"254712345678"}'
```

Monitor logs for STK Push status and callback processing.

## Troubleshooting

**M-Pesa Issues:**
- Check Daraja Portal callback logs
- Verify phone format (2547XXXXXXXX)
- Test with sandbox first

**MongoDB:**
```
npm run connect  # Test connection
```

**CORS Errors:**
Update origin in `app.use(cors())` for your frontend domain.

## License
MIT - Free for commercial/educational use.[8]

[1](https://about.gitlab.com/blog/deploy-a-nodejs-express-app-with-gitlabs-cloud-run-integration/)
[2](https://cloud.google.com/blog/topics/developers-practitioners/serverless-with-cloud-run-mongodb-atlas)
[3](https://dev.to/kjdowns/building-a-basic-api-using-express-node-and-mongodb-160f)
[4](https://allanjuma.hashnode.dev/how-to-integrate-mpesa-api-to-node-js-application)
[5](https://www.youtube.com/watch?v=XxS5srZC3Oc)
[6](https://github.com/mzagorny/gas-local)
[7](https://github.com/bullishpip/gas-node-clasp-react)
[8](https://devdaim.hashnode.dev/easy-way-to-setup-express-mongo-node-server)
[9](https://forum.freecodecamp.org/t/mongodb-and-mongoose-install-and-set-up-mongoose/616231)
[10](https://stackoverflow.com/questions/59649056/mongoose-error-when-trying-to-connect-to-mongo-db)
[11](https://github.com/AlexMercedCoder/Express-Mongo-Auth-Template)
[12](https://dev.to/chauhoangminhnguyen/deploy-nodejs-typescript-to-google-app-engine-1jka)
[13](https://www.steegle.com/google-products/google-apps-script-faq)
[14](https://www.facebook.com/groups/125499867491756/posts/3259508470757531/)
