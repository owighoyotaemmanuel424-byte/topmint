import { randomBytes, createHash } from 'crypto';
import { z } from 'zod';
import { prisma } from '../../../lib/db/prisma';
import { respondWithError } from '../../../lib/db-error';

const schema = z.object({ email: z.string().trim().email().max(254).transform(v => v.toLowerCase()) }).strict();
const hash = value => createHash('sha256').update(value).digest('hex');

async function sendResetEmail(email, url) {
  if (!process.env.RESEND_API_KEY || !process.env.AUTH_EMAIL_FROM) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.AUTH_EMAIL_FROM, to: [email], subject: 'Reset your TopMint password', text: 'A password reset was requested for your TopMint account. This link expires in 30 minutes and can be used once: ' + url + '\n\nIf you did not request this, ignore this email.' }),
  });
  return response.ok;
}
export default async function handler(req,res) {
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
 const parsed=schema.safeParse(req.body);
 if(!parsed.success)return res.status(200).json({message:'If an eligible account exists, instructions will be sent when email delivery is configured.'});
 try {
  const ip=String(req.headers['x-forwarded-for']||'unknown').split(',')[0].trim().slice(0,64);
  const recent=await prisma.auditLog.count({where:{action:'password.reset_request',ipAddress:ip,createdAt:{gte:new Date(Date.now()-15*60*1000)}}});
  if(recent>=5)return res.status(429).json({error:'Too many requests. Please try again later.'});
  await prisma.auditLog.create({data:{action:'password.reset_request',entity:'Auth',ipAddress:ip,metadata:{emailHash:hash(parsed.data.email)}}});
  const user=await prisma.user.findUnique({where:{email:parsed.data.email},select:{id:true,email:true,status:true}});
  if(user&&user.status==='ACTIVE'&&process.env.RESEND_API_KEY&&process.env.AUTH_EMAIL_FROM&&process.env.NEXT_PUBLIC_APP_URL){
   const raw=randomBytes(32).toString('base64url');
   await prisma.passwordResetToken.create({data:{userId:user.id,tokenHash:hash(raw),expiresAt:new Date(Date.now()+30*60*1000)}});
   const url=new URL('/reset-password',process.env.NEXT_PUBLIC_APP_URL);url.searchParams.set('token',raw);
   const accepted=await sendResetEmail(user.email,url.toString());
   if(!accepted) await prisma.passwordResetToken.updateMany({where:{tokenHash:hash(raw),consumedAt:null},data:{consumedAt:new Date()}});
  }
  return res.status(200).json({message:'If an eligible account exists, instructions will be sent when email delivery is configured.'});
 } catch(error){return respondWithError(res,error,{fallback:'RESET_REQUEST_FAILED',message:'Unable to process this request right now.'});}
}
