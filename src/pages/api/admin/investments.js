import { requireAdmin } from '../../../lib/admin-auth';
import { prisma } from '../../../lib/db/prisma';
import { respondWithError } from '../../../lib/db-error';
const statuses=['ACTIVE','COMPLETED','CANCELLED'];
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const admin=await requireAdmin(req,res,['SUPER_ADMIN','ADMIN','SUPPORT']);if(!admin)return;
 try{
  const page=Math.max(1,Number.parseInt(req.query.page,10)||1),pageSize=Math.min(100,Math.max(1,Number.parseInt(req.query.pageSize,10)||25));
  const status=typeof req.query.status==='string'&&statuses.includes(req.query.status)?req.query.status:'ALL';
  const search=typeof req.query.search==='string'?req.query.search.trim().slice(0,120):'';
  const where={...(status==='ALL'?{}:{status}),...(search?{OR:[{reference:{contains:search,mode:'insensitive'}},{user:{email:{contains:search,mode:'insensitive'}}},{user:{firstName:{contains:search,mode:'insensitive'}}},{user:{lastName:{contains:search,mode:'insensitive'}}}]}:{})};
  const [total,rows]=await prisma.$transaction([prisma.investment.count({where}),prisma.investment.findMany({where,include:{user:{select:{id:true,email:true,firstName:true,lastName:true}},plan:true,transactions:{select:{id:true,reference:true,type:true,status:true,amount:true,createdAt:true,metadata:true}}},orderBy:{startedAt:'desc'},skip:(page-1)*pageSize,take:pageSize})]);
  return res.status(200).json({investments:rows.map(i=>({id:i.id,reference:i.reference,userId:i.userId,customer:i.user,plan:{id:i.plan.id,name:i.plan.name},principal:i.principal.toString(),expectedReturn:i.expectedReturn.toString(),actualReturn:i.actualReturn.toString(),accruedEarnings:i.accruedEarnings.toString(),paidEarnings:i.paidEarnings.toString(),status:i.status,startedAt:i.startedAt,maturityAt:i.maturityAt,completedAt:i.completedAt,termsSnapshot:i.termsSnapshot,transactions:i.transactions.map(t=>({...t,amount:t.amount.toString()}))})),page,pageSize,total,totalPages:Math.max(1,Math.ceil(total/pageSize))});
 }catch(error){return respondWithError(res,error,{fallback:'ADMIN_INVESTMENTS_UNAVAILABLE',message:'Unable to load investment records.'});}
}