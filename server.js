require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(cors({origin: 'https://n-alobkaf7y666kv4bbv4qm3252t7tqnixej4ueea-0lu-script.googleusercontent.com'}));

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME || 'document_store';
let db;

// Initialize MongoDB connection
async function connectDB() {
  try {
    const client = await MongoClient.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    db = client.db(DB_NAME);
    
    // Create indexes
    await createIndexes();
    
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
}

// Create database indexes
async function createIndexes() {
  try {
    // Users collection indexes
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('users').createIndex({ tokens: 1 });
    
    // Payments collection indexes
    await db.collection('payments').createIndex({ userId: 1 });
    await db.collection('payments').createIndex({ status: 1 });
    await db.collection('payments').createIndex({ checkoutRequestId: 1 });
    await db.collection('payments').createIndex({ createdAt: -1 });
    
    // Downloads collection indexes
    await db.collection('downloads').createIndex({ userId: 1 });
    await db.collection('downloads').createIndex({ documentId: 1 });
    await db.collection('downloads').createIndex({ createdAt: -1 });
    
    // Payment logs indexes
    await db.collection('paymentLogs').createIndex({ paymentId: 1 });
    await db.collection('paymentLogs').createIndex({ createdAt: -1 });
    
    // Admin users indexes
    await db.collection('adminUsers').createIndex({ username: 1 }, { unique: true });
    
    // Token grants indexes
    await db.collection('tokenGrants').createIndex({ userId: 1 });
    await db.collection('tokenGrants').createIndex({ createdAt: -1 });
    
    console.log('✅ Database indexes created');
  } catch (error) {
    console.error('Error creating indexes:', error);
  }
}

// Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-key';
const TOKEN_PRICE = 1; // KSH per token

// M-Pesa Configuration
const MPESA_CONFIG = {
  consumerKey: process.env.MPESA_CONSUMER_KEY,
  consumerSecret: process.env.MPESA_CONSUMER_SECRET,
  businessShortCode: process.env.MPESA_SHORTCODE,
  passkey: process.env.MPESA_PASSKEY,
  callbackUrl: process.env.MPESA_CALLBACK_URL || 'https://yourdomain.com/api/mpesa/callback',
  environment: process.env.MPESA_ENV || 'sandbox'
};

const MPESA_BASE_URL = MPESA_CONFIG.environment === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

// Documents catalog
const DOCUMENTS = {
  'agric-paper-1': {
    id: '1Mky5kBJX84sssm9DAGrtMpPG6WpcClDN',
    name: 'AGRICULTURE PAPER 1.pdf',
    driveUrl: 'https://drive.google.com/uc?id=1Mky5kBJX84sssm9DAGrtMpPG6WpcClDN&export=download',
    tokensRequired: 1,
    category: 'Agriculture',
    year: '2024'
  }
};

// ==================== AUTHENTICATION MIDDLEWARE ====================

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// ==================== M-PESA FUNCTIONS ====================

async function getMpesaToken() {
  try {
    const auth = Buffer.from(
      `${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`
    ).toString('base64');

    const response = await axios.get(
      `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: {
          Authorization: `Basic ${auth}`
        }
      }
    );

    return response.data.access_token;
  } catch (error) {
    console.error('M-Pesa token error:', error.response?.data || error.message);
    throw new Error('Failed to get M-Pesa token');
  }
}

async function initiateStkPush(phoneNumber, amount, accountReference) {
  try {
    const token = await getMpesaToken();
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(
      `${MPESA_CONFIG.businessShortCode}${MPESA_CONFIG.passkey}${timestamp}`
    ).toString('base64');

    const formattedPhone = phoneNumber.startsWith('254') 
      ? phoneNumber 
      : phoneNumber.startsWith('0') 
      ? '254' + phoneNumber.slice(1)
      : '254' + phoneNumber;

    const response = await axios.post(
      `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: MPESA_CONFIG.businessShortCode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: formattedPhone,
        PartyB: MPESA_CONFIG.businessShortCode,
        PhoneNumber: formattedPhone,
        CallBackURL: MPESA_CONFIG.callbackUrl,
        AccountReference: accountReference,
        TransactionDesc: `Purchase ${accountReference}`
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      success: true,
      checkoutRequestId: response.data.CheckoutRequestID,
      merchantRequestId: response.data.MerchantRequestID,
      responseCode: response.data.ResponseCode,
      responseDescription: response.data.ResponseDescription
    };
  } catch (error) {
    console.error('STK Push error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.errorMessage || 'Failed to initiate payment'
    };
  }
}

// ==================== USER ROUTES ====================

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, fullName, phoneNumber } = req.body;

    if (!email || !password || !fullName || !phoneNumber) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if user exists
    const existingUser = await db.collection('users').findOne({ email });

    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const result = await db.collection('users').insertOne({
      email,
      password: hashedPassword,
      fullName,
      phoneNumber,
      tokens: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Generate JWT
    const token = jwt.sign(
      { id: result.insertedId.toString(), email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: result.insertedId.toString(),
        email,
        fullName,
        tokens: 0
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await db.collection('users').findOne({ email });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user._id.toString(), email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user._id.toString(),
        email: user.email,
        fullName: user.fullName,
        tokens: user.tokens
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(req.user.id) },
      { projection: { password: 0 } }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ 
      success: true, 
      user: {
        id: user._id.toString(),
        email: user.email,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        tokens: user.tokens,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ==================== TOKEN PURCHASE ROUTES ====================

app.post('/api/tokens/purchase', authenticateToken, async (req, res) => {
  try {
    const { numberOfTokens, phoneNumber } = req.body;

    if (!numberOfTokens || numberOfTokens < 1) {
      return res.status(400).json({ error: 'Invalid number of tokens' });
    }

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number required' });
    }

    const amount = numberOfTokens * TOKEN_PRICE;
    const accountReference = `TOKENS-${req.user.id}`;

    // Create pending payment record
    const paymentResult = await db.collection('payments').insertOne({
      userId: new ObjectId(req.user.id),
      amount,
      tokensPurchased: numberOfTokens,
      status: 'pending',
      phoneNumber,
      createdAt: new Date()
    });

    const paymentId = paymentResult.insertedId.toString();

    // Initiate M-Pesa STK Push
    const mpesaResponse = await initiateStkPush(
      phoneNumber,
      amount,
      `${accountReference}-${paymentId}`
    );

    if (mpesaResponse.success) {
      // Update payment record with M-Pesa details
      await db.collection('payments').updateOne(
        { _id: paymentResult.insertedId },
        { 
          $set: { 
            checkoutRequestId: mpesaResponse.checkoutRequestId,
            merchantRequestId: mpesaResponse.merchantRequestId
          }
        }
      );

      res.json({
        success: true,
        message: 'Payment request sent. Please check your phone.',
        paymentId,
        checkoutRequestId: mpesaResponse.checkoutRequestId
      });
    } else {
      // Update payment status to failed
      await db.collection('payments').updateOne(
        { _id: paymentResult.insertedId },
        { $set: { status: 'failed' } }
      );

      res.status(400).json({
        success: false,
        error: mpesaResponse.error || 'Payment initiation failed'
      });
    }
  } catch (error) {
    console.error('Purchase error:', error);
    res.status(500).json({ error: 'Purchase failed' });
  }
});

app.get('/api/payment/status/:paymentId', authenticateToken, async (req, res) => {
  try {
    const { paymentId } = req.params;

    const payment = await db.collection('payments').findOne({
      _id: new ObjectId(paymentId),
      userId: new ObjectId(req.user.id)
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    res.json({
      success: true,
      status: payment.status,
      tokensPurchased: payment.tokensPurchased
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// ==================== M-PESA CALLBACK ====================

app.post('/api/mpesa/callback', async (req, res) => {
  try {
    console.log('M-Pesa Callback:', JSON.stringify(req.body, null, 2));

    const { Body } = req.body;
    const { stkCallback } = Body;

    const checkoutRequestId = stkCallback.CheckoutRequestID;
    const resultCode = stkCallback.ResultCode;
    const resultDesc = stkCallback.ResultDesc;

    // Find payment record
    const payment = await db.collection('payments').findOne({ 
      checkoutRequestId 
    });

    if (!payment) {
      console.error('Payment not found for checkout:', checkoutRequestId);
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    if (resultCode === 0) {
      // Payment successful
      const callbackMetadata = stkCallback.CallbackMetadata.Item;
      const mpesaReceiptNumber = callbackMetadata.find(
        item => item.Name === 'MpesaReceiptNumber'
      )?.Value;

      const transactionDate = callbackMetadata.find(
        item => item.Name === 'TransactionDate'
      )?.Value;

      // Update payment record
      await db.collection('payments').updateOne(
        { _id: payment._id },
        { 
          $set: { 
            status: 'completed',
            mpesaReceipt: mpesaReceiptNumber,
            transactionDate: transactionDate?.toString(),
            completedAt: new Date()
          }
        }
      );

      // Add tokens to user account
      await db.collection('users').updateOne(
        { _id: payment.userId },
        { 
          $inc: { tokens: payment.tokensPurchased },
          $set: { updatedAt: new Date() }
        }
      );

      console.log(`✅ Payment successful. Added ${payment.tokensPurchased} tokens to user ${payment.userId}`);
    } else {
      // Payment failed
      await db.collection('payments').updateOne(
        { _id: payment._id },
        { 
          $set: { 
            status: 'failed',
            resultDesc
          }
        }
      );

      console.log(`❌ Payment failed: ${resultDesc}`);
    }

    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    console.error('Callback error:', error);
    res.json({ ResultCode: 1, ResultDesc: 'Error processing callback' });
  }
});

// ==================== DOCUMENT ROUTES ====================

app.get('/api/documents', (req, res) => {
  const docs = Object.entries(DOCUMENTS).map(([key, doc]) => ({
    id: key,
    ...doc
  }));
  res.json({ success: true, documents: docs });
});

app.post('/api/document/download', authenticateToken, async (req, res) => {
  try {
    const { documentId } = req.body;

    const document = DOCUMENTS[documentId];

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Check user tokens
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(req.user.id) },
      { projection: { tokens: 1 } }
    );

    if (user.tokens < document.tokensRequired) {
      return res.status(403).json({
        error: 'Insufficient tokens',
        required: document.tokensRequired,
        available: user.tokens
      });
    }

    // Deduct token
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.user.id) },
      { 
        $inc: { tokens: -document.tokensRequired },
        $set: { updatedAt: new Date() }
      }
    );

    // Generate download token
    const downloadToken = jwt.sign(
      {
        userId: req.user.id,
        fileId: document.id,
        documentId: documentId
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Record download
    await db.collection('downloads').insertOne({
      userId: new ObjectId(req.user.id),
      documentId,
      fileId: document.id,
      tokensUsed: document.tokensRequired,
      createdAt: new Date(),
      downloadedAt: null
    });

    res.json({
      success: true,
      downloadUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/download/${downloadToken}`,
      expiresIn: 3600,
      tokensRemaining: user.tokens - document.tokensRequired
    });
  } catch (error) {
    console.error('Download request error:', error);
    res.status(500).json({ error: 'Failed to process download' });
  }
});

app.get('/download/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const decoded = jwt.verify(token, JWT_SECRET);

    const document = DOCUMENTS[decoded.documentId];

    if (!document) {
      return res.status(404).send('Document not found');
    }

    // Mark as downloaded
    await db.collection('downloads').updateOne(
      { 
        userId: new ObjectId(decoded.userId),
        documentId: decoded.documentId,
        downloadedAt: null
      },
      { $set: { downloadedAt: new Date() } }
    );

    // Redirect to Google Drive
    res.redirect(document.driveUrl);
  } catch (error) {
    console.error('Download error:', error);
    res.status(403).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Access Denied</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              text-align: center;
              padding: 50px;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
            }
            .container {
              background: white;
              color: #333;
              padding: 40px;
              border-radius: 10px;
              max-width: 500px;
              margin: 0 auto;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🔒 Access Denied</h1>
            <p>This download link has expired or is invalid.</p>
            <p><a href="/">Return to homepage</a></p>
          </div>
        </body>
      </html>
    `);
  }
});

app.get('/api/user/downloads', authenticateToken, async (req, res) => {
  try {
    const downloads = await db.collection('downloads')
      .find({ userId: new ObjectId(req.user.id) })
      .sort({ createdAt: -1 })
      .limit(50)
      .project({ userId: 0 })
      .toArray();

    res.json({ success: true, downloads });
  } catch (error) {
    console.error('Downloads history error:', error);
    res.status(500).json({ error: 'Failed to fetch downloads' });
  }
});

// ==================== ANALYTICS ROUTES ====================

app.get('/api/analytics/sales', authenticateToken, async (req, res) => {
  try {
    const dailySales = await db.collection('payments').aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$completedAt' }
          },
          totalTransactions: { $sum: 1 },
          totalRevenue: { $sum: '$amount' },
          totalTokensSold: { $sum: '$tokensPurchased' }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: 30 }
    ]).toArray();

    res.json({ success: true, sales: dailySales });
  } catch (error) {
    console.error('Sales analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch sales data' });
  }
});

// ==================== START SERVER ====================

const PORT = process.env.PORT || 3000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 M-Pesa Environment: ${MPESA_CONFIG.environment}`);
  });

});

