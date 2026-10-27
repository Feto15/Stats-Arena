import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { createDatabase, authInvitations, authUsers } from "@statsarena/db";
import { authSettings } from "../lib/auth/settings";
import { hashInvitation } from "../lib/auth/invitations";
import { normalizeEmail } from "../lib/auth/policy";

const args=process.argv.slice(2);
if(args.includes("--help")) {
  console.log("Usage: pnpm --dir dashboard run auth:bootstrap --email <admin-email> [--dry-run]\nCreates one first-admin invitation in StatsArena. No password is chosen. The private activation URL is saved to dashboard/.auth-bootstrap.json, never printed. Refuses once an admin exists.");
} else {
  if(args[0]!=="--email"||!args[1]||args.length>(args.includes("--dry-run")?3:2)||args[2]&&args[2]!=="--dry-run")throw new Error("Use --help for usage.");
  const email=normalizeEmail(args[1]); const settings=authSettings(); const connection=createDatabase();
  try {
    const baseline=await connection.db.execute(sql`select count(*)::integer as n from statsarena.competitions where source='genius_sports' and source_competition_id in ('49607','49609')`);
    if(baseline[0]?.["n"]!==2)throw new Error("StatsArena target could not be confirmed.");
    const file=resolve(process.cwd(),".auth-bootstrap.json");
    const result=await connection.db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(70382514)`);
      const [admin]=await tx.select({id:authUsers.id}).from(authUsers).where(eq(authUsers.isAdmin,true)).limit(1);
      if(admin)throw new Error("An admin already exists; first-admin bootstrap refused.");
      const [pending]=await tx.select().from(authInvitations).where(and(eq(authInvitations.makeAdmin,true),isNull(authInvitations.acceptedAt),isNull(authInvitations.revokedAt),gt(authInvitations.expiresAt,new Date()))).limit(1);
      if(pending){
        try {
          const saved=z.object({url:z.string(),email:z.string()}).parse(JSON.parse(await readFile(file,"utf8")) as unknown);
          const token=new URL(saved.url).pathname.split("/").at(-1)!;
          if(saved.email===email&&pending.email===email&&hashInvitation(token)===pending.tokenHash)return {reused:true};
        }catch{/* Never replace an existing pending bootstrap without its matching private file. */}
        throw new Error("A pending first-admin invitation exists. Recover the private activation file or revoke the old invitation before creating another.");
      }
      if(args.includes("--dry-run"))return {preview:true};
      const token=randomBytes(32).toString("base64url"); const expiresAt=new Date(Date.now()+72*60*60*1000);
      await tx.insert(authInvitations).values({email,tokenHash:hashInvitation(token),grants:[],makeAdmin:true,expiresAt});
      const url=`${settings.baseURL.replace(/\/$/,"")}/invite/${token}`;
      await writeFile(file,JSON.stringify({email,url,expiresAt:expiresAt.toISOString()},null,2)+"\n",{mode:0o600});await chmod(file,0o600);
      return {created:true};
    });
    console.log(result.preview?"Preview verified: ready to create a first-admin invitation.":result.reused?"Existing first-admin activation file retained.":"First-admin invitation created. Activation URL saved privately in dashboard/.auth-bootstrap.json.");
  }catch(error){
    const known=["StatsArena target could not be confirmed.","An admin already exists; first-admin bootstrap refused.","A pending first-admin invitation exists. Recover the private activation file or revoke the old invitation before creating another."];
    console.error(error instanceof Error&&known.includes(error.message)?error.message:"Admin bootstrap failed; verify StatsArena configuration.");process.exitCode=1;
  }
  finally{await connection.close();}
}
