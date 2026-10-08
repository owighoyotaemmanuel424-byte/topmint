import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../../lib/db/prisma';
import { createAdminToken } from '../../../lib/auth';

const schema=z.object({email:z.string().trim().email(),password:z.string().min(1).max(128)});
export default async function handler(req,res){
 if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
 const p=schema.safeParse(req.body); if(!p.success) return res.status(400).json({error:'Enter a valid email and password.'});
 try{
  const admin=await prisma.admin.findUnique({where:{email:p.data.email.toLowerCase()}});
  if(!admin||!admin.active||!(await bcrypt.compare(p.data.password,admin.passwordHash))) return res.status(401).json({error:'Invalid admin credentials.'});
  const token=await createAdminToken(admin.id);
  res.setHeader('Set-Cookie',`admin_token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`);
  return res.status(200).json({admin:{id:admin.id,email:admin.email,name:admin.name,role:admin.role}});
 }catch(e){console.error('admin signin',e);return res.status(500).json({error:'Unable to sign in right now.'})}
}
