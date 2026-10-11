import { prisma } from '../../../lib/db/prisma';
import { classifyDatabaseError } from '../../../lib/db-error';
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{const plans=await prisma.investmentPlan.findMany({where:{active:true},orderBy:{minimumAmount:'asc'}});
 return res.status(200).json({plans:plans.map(p=>({...p,minimumAmount:p.minimumAmount.toString(),maximumAmount:p.maximumAmount?.toString()??null,returnRate:p.returnRate.toString(),feeRate:p.feeRate.toString()}))});
 }catch(error){const code=classifyDatabaseError(error,'PLANS_UNAVAILABLE');console.error('investment plans error',{code,message:error?.message});return res.status(503).json({error:'Investment plans are temporarily unavailable.',code});}
}
