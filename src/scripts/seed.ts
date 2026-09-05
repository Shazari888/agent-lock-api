import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tenantId = process.env.SEED_TENANT_ID ?? "tenant_demo";
  const tenantName = process.env.SEED_TENANT_NAME ?? "Demo Tenant";
  const policyId = process.env.SEED_POLICY_ID ?? "policy_default";

  await prisma.tenant.upsert({
    where: { id: tenantId },
    update: {
      name: tenantName
    },
    create: {
      id: tenantId,
      name: tenantName
    }
  });

  await prisma.policy.upsert({
    where: { id: policyId },
    update: {
      tenantId,
      name: "Default AgentLock v1 policy",
      version: "v1",
      mode: "ENFORCE",
      emergencyBypass: false,
      blockedCommands: ["rm", "shutdown", "reboot"],
      blockedPatterns: ["curl | sh", "wget | bash", "mkfs."],
      requireVerifiedContext: true
    },
    create: {
      id: policyId,
      tenantId,
      name: "Default AgentLock v1 policy",
      version: "v1",
      mode: "ENFORCE",
      emergencyBypass: false,
      blockedCommands: ["rm", "shutdown", "reboot"],
      blockedPatterns: ["curl | sh", "wget | bash", "mkfs."],
      requireVerifiedContext: true
    }
  });

  console.log(
    JSON.stringify(
      {
        seeded: true,
        tenant_id: tenantId,
        policy_id: policyId
      },
      null,
      2
    )
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

