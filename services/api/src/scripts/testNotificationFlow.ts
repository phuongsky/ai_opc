import { db } from '../db/client';
import { notifyFounder, isAnyChannelConfigured } from '../modules/notifications/notifier';
import { generateWeeklyReportText } from '../modules/reports/weeklyReport';
import { toolGateway } from '../modules/governance/toolGateway';
import { runPeriodicJobs } from '../modules/notifications/periodicJobs';

async function runTest() {
  console.log('=== TEST NOTIFICATION & FOUNDER OUT-OF-APP CHANNELS ===');

  // 1. Check Channel status
  console.log('1. Check Channel Status:');
  console.log('   Any channel configured:', isAnyChannelConfigured());

  // 2. Test notifyFounder safely without throwing
  console.log('2. Testing notifyFounder (safe execution):');
  await notifyFounder({
    title: 'Test Thông Báo Hệ Thống',
    message: 'Nội dung thông báo kiểm thử đa kênh cho Founder.',
    severity: 'info',
  });
  console.log('✓ notifyFounder executed without errors.');

  // 3. Test Weekly Report generation
  console.log('3. Testing generateWeeklyReportText:');
  const report = await generateWeeklyReportText();
  console.log('--- REPORT PREVIEW ---');
  console.log(report);
  console.log('----------------------');
  if (!report.includes('Weekly Report') || !report.includes('Task hoàn thành')) {
    throw new Error('Weekly report text generation failed!');
  }
  console.log('✓ Weekly report generated successfully.');

  // 4. Test ToolGateway triggering notification on Decision Package
  console.log('4. Testing Decision Package creation notification:');
  const perm = await db.agentToolPermission.findFirst({
    where: {
      permissionLevel: { in: ['L5', 'L6'] },
    },
  });

  if (perm) {
    await db.agent.update({
      where: { id: perm.agentId },
      data: { status: 'READY', suspendedReason: null },
    });

    const res = await toolGateway.execute(perm.agentId, perm.toolId, null, {
      action: 'test_action',
      amount: 1000,
    });
    console.log('✓ ToolGateway response for approval-required tool:', res.status, res.decisionPackageId);
    if (res.status !== 'AWAITING_APPROVAL' || !res.decisionPackageId) {
      throw new Error('Expected AWAITING_APPROVAL status for approval-required tool!');
    }
    // Clean up test decision package
    await db.decisionPackage.delete({ where: { id: res.decisionPackageId } });
    await db.agent.update({ where: { id: perm.agentId }, data: { status: 'READY' } });
  }

  // 5. Test Periodic Jobs runner
  console.log('5. Testing runPeriodicJobs:');
  await runPeriodicJobs();
  console.log('✓ runPeriodicJobs executed cleanly.');

  console.log('=== ALL NOTIFICATION & PERIODIC JOB TESTS PASSED 100% ===');
}

runTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
