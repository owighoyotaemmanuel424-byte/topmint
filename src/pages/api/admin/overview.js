import { prisma } from '../../../lib/db/prisma';
import { requireAdmin } from '../../../lib/admin-auth';
import { respondWithError } from '../../../lib/db-error';
const money=v=>v?.toString?.()??'0.00';
export default async function handler(req,res){
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
 const admin=await requireAdmin(req,res,['SUPER_ADMIN','ADMIN','SUPPORT']);if(!admin)return;
 try{
 const [totalUsers,activeUsers,suspendedUsers,verifiedDeposits,pendingDeposits,pendingWithdrawals,activeInvestments,principal,investmentReturns,paidWithdrawals,wallets,recentTransactions,recentUsers,securityEvents,pendingDepositCount,pendingWithdrawalCount]=await Promise.all([
 prisma.user.count(),prisma.user.count({where:{status:'ACTIVE'}}),prisma.user.count({where:{status:'SUSPENDED'}}),
 prisma.deposit.aggregate({where:{status:'COMPLETED'},_sum:{amount:true}}),prisma.deposit.aggregate({where:{status:'PENDING'},_sum:{amount:true}}),
 prisma.withdrawal.aggregate({where:{status:'PENDING'},_sum:{amount:true}}),prisma.investment.count({where:{status:'ACTIVE'}}),
 prisma.investment.aggregate({where:{status:{in:['ACTIVE','COMPLETED']}},_sum:{principal:true}}),
 prisma.investment.aggregate({_sum:{actualReturn:true}}),
 prisma.withdrawal.aggregate({where:{status:'COMPLETED'},_sum:{amount:true}}),
 prisma.wallet.aggregate({_sum:{balance:true}}),
 prisma.transaction.findMany({take:8,orderBy:{createdAt:'desc'},select:{id:true,reference:true,type:true,status:true,amount:true,currency:true,createdAt:true,user:{select:{email:true,firstName:true,lastName:true}}}}),
 prisma.user.findMany({take:6,orderBy:{createdAt:'desc'},select:{id:true,email:true,firstName:true,lastName:true,status:true,createdAt:true}}),
 prisma.auditLog.findMany({where:{OR:[{action:{contains:'SECURITY',mode:'insensitive'}},{action:{contains:'login',mode:'insensitive'}},{action:{contains:'suspend',mode:'insensitive'}},{entity:'Auth'}]},take:8,orderBy:{createdAt:'desc'},select:{id:true,action:true,entity:true,entityId:true,createdAt:true,admin:{select:{email:true}},user:{select:{email:true}}}}),
 prisma.deposit.count({where:{status:'PENDING'}}),prisma.withdrawal.count({where:{status:'PENDING'}})
 ]);
 return res.status(200).json({admin:{id:admin.id,name:admin.name,email:admin.email,role:admin.role},metrics:{totalUsers,activeUsers,suspendedUsers,verifiedDeposits:money(verifiedDeposits._sum.amount),pendingDepositRequests:money(pendingDeposits._sum.amount),pendingWithdrawals:money(pendingWithdrawals._sum.amount),activeInvestments,totalInvestedPrincipal:money(principal._sum.principal),recordedInvestmentReturns:money(investmentReturns._sum.actualReturn),completedWithdrawals:money(paidWithdrawals._sum.amount),walletBalances:money(wallets._sum.balance),pendingTasks:pendingDepositCount+pendingWithdrawalCount},recentTransactions:recentTransactions.map(t=>({...t,amount:money(t.amount)})),recentUsers,securityEvents});
 }catch(error){return respondWithError(res,error,{fallback:'ADMIN_OVERVIEW_FAILED',message:'Unable to load the admin overview.'});}
}
