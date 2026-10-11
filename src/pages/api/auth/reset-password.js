import { createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../../lib/db/prisma';
import { notify } from '../../../lib/notifications';
import { respondWithError } from '../../../lib/db-error';
const schema=z.object({token:z.string().min(30).max(200),password:z.string().min(12).max(128)}).strict();
const hash=value=>createHash('sha256').update(value).digest('hex');
export default async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
 const parsed=schema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Invalid or expired reset link.'});
 try{
  const tokenHash=hash(parsed.data.token);
  const token=await prisma.passwordResetToken.findUnique({where:{tokenHash},include:{user:{select:{id:true,status:true}}}});
  if(!token||token.consumedAt||token.expiresAt<=new Date()||token.user.status!=='ACTIVE')return res.status(400).json({error:'Invalid or expired reset link.'});
  const passwordHash=await bcrypt.hash(parsed.data.password,12);
  await prisma.$transaction(async tx=>{
   const consumed=await tx.passwordResetToken.updateMany({where:{id:token.id,consumedAt:null,expiresAt:{gt:new Date()}},data:{consumedAt:new Date()}});
   if(consumed.count!==1)throw new Error('RESET_TOKEN_ALREADY_USED');
   await tx.user.update({where:{id:token.userId},data:{passwordHash,passwordChangedAt:new Date(),sessionVersion:{increment:1}}});
   await tx.passwordResetToken.updateMany({where:{userId:token.userId,consumedAt:null},data:{consumedAt:new Date()}});
   await tx.auditLog.create({data:{userId:token.userId,action:'password.reset',entity:'User',entityId:token.userId}});
  });
  await notify(prisma,{userId:token.userId,type:'SECURITY',title:'Your password was reset',message:'Your TopMint password was reset. If you did not make this change, contact support immediately.',resourceType:'User',resourceId:token.userId,link:'/dashboard/security',eventKey:'password-reset:'+token.id});
  return res.status(200).json({ok:true});
 }catch(error){if(error?.message==='RESET_TOKEN_ALREADY_USED')return res.status(400).json({error:'Invalid or expired reset link.'});return respondWithError(res,error,{fallback:'PASSWORD_RESET_FAILED',message:'Unable to reset your password.'});}
}
