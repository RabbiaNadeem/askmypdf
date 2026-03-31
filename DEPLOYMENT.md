# Deployment Guide

This project is configured for deployment on two platforms:
- **Frontend**: Vercel (Next.js)
- **Backend**: Railway (FastAPI)

## Backend Deployment (Railway)

### Prerequisites
- Railway account (https://railway.app)
- GitHub repository connected to Railway

### Configuration Files
- `Procfile` - Specifies how to run the application
- `runtime.txt` - Python version specification
- `railway.json` - Railway-specific configuration

### Setup Steps

1. **Connect to Railway**
   - Go to https://railway.app
   - Create a new project
   - Connect your GitHub repository
   - Select the `backend` directory as the root directory

2. **Set Environment Variables**
   In Railway dashboard, add the following environment variables:
   ```
   CORS_ORIGINS=https://your-frontend-url.vercel.app
   GROQ_API_KEY=your_groq_api_key
   SUPABASE_URL=your_supabase_url
   SUPABASE_KEY=your_supabase_key
   ```

3. **Deploy**
   - Railway will automatically build and deploy when you push to your main branch
   - The application will run on `https://your-railway-app-url`

### Accessing Backend
- Health check: `https://your-railway-app-url/`
- Chat endpoint: `https://your-railway-app-url/chat`
- Upload endpoint: `https://your-railway-app-url/documents`

---

## Frontend Deployment (Vercel)

### Prerequisites
- Vercel account (https://vercel.com)
- GitHub repository connected to Vercel

### Configuration Files
- `vercel.json` - Vercel-specific configuration
- `.vercelignore` - Files to exclude from deployment
- `next.config.ts` - Next.js configuration with Vercel optimization

### Setup Steps

1. **Connect to Vercel**
   - Go to https://vercel.com/new
   - Import your GitHub repository
   - Vercel will automatically detect Next.js
   - Select root directory as `./` (or where package.json is located)

2. **Set Environment Variables**
   In Vercel project settings, add:
   ```
   NEXT_PUBLIC_API_URL=https://your-railway-app-url
   ```
   
   Note: Only variables prefixed with `NEXT_PUBLIC_` will be available in the browser

3. **Configure Build Settings**
   - Build Command: `npm run build`
   - Output Directory: `.next`
   - Install Command: `npm install`

4. **Deploy**
   - Vercel will automatically deploy when you push to your main branch
   - The application will be available at `https://your-project.vercel.app`

---

## Environment Variables Summary

### Frontend (.env.local or Vercel)
```
NEXT_PUBLIC_API_URL=https://your-railway-backend.railway.app
```

### Backend (Railway Environment Variables)
```
CORS_ORIGINS=https://your-vercel-frontend.vercel.app
PORT=8000
GROQ_API_KEY=your_api_key
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
```

---

## CORS Configuration

The backend is configured to accept requests from the frontend URL. When deploying:

1. Backend will read from `CORS_ORIGINS` environment variable
2. Update `CORS_ORIGINS` to your Vercel frontend URL
3. The frontend can then make requests to the backend API

Example:
- Frontend: `https://my-app.vercel.app`
- Backend: `https://my-api.railway.app`
- CORS_ORIGINS: `https://my-app.vercel.app`

---

## Monitoring & Debugging

### Railway
- View logs in Railway dashboard under "Deployments"
- Check environment variables under "Variables"
- Monitor resource usage in "Environment" tab

### Vercel
- View logs in Vercel dashboard under "Deployments"
- Monitor function execution in "Functions" tab
- Check build logs if deployment fails

---

## Redeployment

### Manual Redeployment
- **Railway**: Push to main branch or manually trigger in dashboard
- **Vercel**: Push to main branch or redeploy manually in dashboard

### CI/CD
Both platforms support automatic redeployment on git push to main branch.

---

## Troubleshooting

### CORS Errors in Frontend
- Verify `NEXT_PUBLIC_API_URL` in Vercel environment variables
- Check backend's `CORS_ORIGINS` includes your frontend URL
- Ensure backend is running and accessible

### Backend API Not Responding
- Check Railway logs for errors
- Verify environment variables are set correctly
- Test health endpoint: `curl https://your-railway-app/`

### Build Failures
- **Vercel**: Check build logs in dashboard → Deployments
- **Railway**: Check deployment logs in dashboard

---

## Local Development

For local testing before deployment:

### Backend
```bash
cd backend
python -m pip install -r requirements.txt
python main.py
```

### Frontend
```bash
npm install
npm run dev
```

Then set `NEXT_PUBLIC_API_URL=http://localhost:8000` in `.env.local`
