import { prisma } from '../../../lib/db/prisma';
import { requireAdmin } from '../../../lib/admin-auth';

export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const admin = await requireAdmin(req, res, ['SUPER_ADMIN', 'ADMIN', 'SUPPORT']);
 if (!admin) return;
 try{
  const [users,investments,withdrawals,pendingWithdrawals]=await Promise.all([
   prisma.user.count(),prisma.investment.count(),prisma.withdrawal.count(),prisma.withdrawal.count({where:{status:'PENDING'}})
  ]);
  return res.status(200).json({counts:{users,investments,withdrawals,pendingWithdrawals}});
 }catch(e){console.error('admin overview',e);return res.status(500).json({error:'Unable to load dashboard.'})}
}
