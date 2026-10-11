import { z } from 'zod';
import { requireAdmin } from '../../../lib/admin-auth';
import { prisma } from '../../../lib/db/prisma';
import { respondWithError } from '../../../lib/db-error';
const positiveInt=(v,fallback,max)=>{const n=Number(v);return Number.isInteger(n)&&n>0?Math.min(n,max):fallback};
export default async function handler(req,res){
 const admin=await requireAdmin(req,res,['SUPER_ADMIN','ADMIN','SUPPORT']);if(!admin)return;
 try{
 if(req.method==='GET'){
 const page=positiveInt(req.query.page,1,1000000),limit=positiveInt(req.query.limit,20,100),q=typeof req.query.q==='string'?req.query.q.trim().slice(0,120):'',status=typeof req.query.status==='string'?req.query.status.toUpperCase():'ALL';
 if(!['ALL','ACTIVE','SUSPENDED','PENDING'].includes(status))return res.status(400).json({error:'Invalid status filter'});
 const where={...(status==='ALL'?{}:{status}),...(q?{OR:[{email:{contains:q,mode:'insensitive'}},{firstName:{contains:q,mode:'insensitive'}},{lastName:{contains:q,mode:'insensitive'}},{id:{contains:q,mode:'insensitive'}}]}:{})};
 const [total,users]=await Promise.all([prisma.user.count({where}),prisma.user.findMany({where,orderBy:{createdAt:'desc'},skip:(page-1)*limit,take:limit,select:{id:true,email:true,firstName:true,lastName:true,phone:true,status:true,createdAt:true,lastLoginAt:true,wallet:{select:{balance:true,currency:true}},_count:{select:{investments:true,transactions:true}}}})]);
 return res.status(200).json({users:users.map(u=>({...u,wallet:u.wallet?{...u.wallet,balance:u.wallet.balance.toString()}:null})),pagination:{page,limit,total,totalPages:Math.ceil(total/limit)}});
 }
 if(req.method==='PATCH'){
 if(!['SUPER_ADMIN','ADMIN'].includes(admin.role))return res.status(403).json({error:'Forbidden'});
 const p=z.object({userId:z.string().min(1).max(100),action:z.enum(['suspend','reactivate']),reason:z.string().trim().min(8).max(500)}).strict().safeParse(req.body);
 if(!p.success)return res.status(400).json({error:'Provide a valid account action and reason.'});
 const {userId,action,reason}=p.data;
 const result=await prisma.$transaction(async tx=>{
 const target=await tx.user.findUnique({where:{id:userId},select:{id:true,status:true}});
 if(!target){const e=new Error('CUSTOMER_NOT_FOUND');throw e;}
 const status=action==='suspend'?'SUSPENDED':'ACTIVE';
 if(target.status===status)return {unchanged:true,user:{id:target.id,status:target.status}};
 const updated=await tx.user.update({where:{id:userId},data:{status},select:{id:true,status:true}});
 await tx.auditLog.create({data:{adminId:admin.id,userId,action:action==='suspend'?'CUSTOMER_SUSPENDED':'CUSTOMER_REACTIVATED',entity:'User',entityId:userId,metadata:{reason,previousStatus:target.status,newStatus:status}}});
 return {user:updated};
 });
 return res.status(200).json(result);
 }
 res.setHeader('Allow','GET, PATCH');return res.status(405).json({error:'Method not allowed'});
 }catch(error){if(error.message==='CUSTOMER_NOT_FOUND')return res.status(404).json({error:'Customer not found.'});return respondWithError(res,error,{fallback:'ADMIN_USERS_FAILED',message:'Unable to process customer request.'});}
}
