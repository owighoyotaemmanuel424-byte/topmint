import { prisma } from '../../../lib/db/prisma';
import { verifyAdminToken } from '../../../lib/auth';

export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const adminId=await verifyAdminToken(req.cookies?.admin_token); if(!adminId)return res.status(401).json({error:'Unauthorized'});
 try{
  const [users,investments,withdrawals,pendingWithdrawals]=await Promise.all([
   prisma.user.count(),prisma.investment.count(),prisma.withdrawal.count(),prisma.withdrawal.count({where:{status:'PENDING'}})
  ]);
  return res.status(200).json({counts:{users,investments,withdrawals,pendingWithdrawals}});
 }catch(e){console.error('admin overview',e);return res.status(500).json({error:'Unable to load dashboard.'})}
}
