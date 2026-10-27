import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { schema, authUsers, authAccounts, authClubAccess, authInvitations } from "@statsarena/db";
import { createReportAuth } from "../lib/auth/factory";
import { acceptInvitation, createStaffInvitation, hashInvitation, invitationPreview, revokeClubAccess, revokeInvitation } from "../lib/auth/invitations";
import { canReadClub, loginContinuation, loginDestination, safeReturnTo, type ReportViewer } from "../lib/auth/policy";
import { reportAccess } from "../lib/reports/reports-access";

const settings={baseURL:"http://localhost:3000",secret:"test-only-private-auth-secret-at-least-32-characters"};
const password="test-only-password-48!";
const grant={competitionKey:"IBL:50231",clubSourceId:"126042"};
test("report authentication, invitation transactions, and club authorization use real Better Auth + SQL", async t=>{
  const client=new PGlite();
  const db=drizzle(client,{schema});
  await migrate(db,{migrationsFolder:fileURLToPath(new URL("../../packages/db/drizzle",import.meta.url)),migrationsSchema:"statsarena",migrationsTable:"__drizzle_migrations"});
  const auth=createReportAuth(db,settings);
  const request=(path:string,body:Record<string,unknown>,ip="127.0.0.10",origin=settings.baseURL)=>auth.handler(new Request(`${settings.baseURL}/api/auth${path}`,{method:"POST",headers:{"content-type":"application/json",origin,"x-forwarded-for":ip},body:JSON.stringify(body)}));
  const seed=async(email:string,grants= [grant],makeAdmin=false)=>{const token=randomBytes(32).toString("base64url");await db.insert(authInvitations).values({email,grants,makeAdmin,tokenHash:hashInvitation(token),expiresAt:new Date(Date.now()+3600000)});return token;};
  let adminId="",staffId="",staffCookie="";
  try {
    await t.test("public signup, forged admin fields, foreign origin and unsigned cookies cannot create/access accounts",async()=>{
      const response=await request("/sign-up/email",{email:"attacker@example.test",name:"Attacker",password,isAdmin:true});
      assert.ok(response.status>=400);assert.equal((await db.select().from(authUsers)).length,0);
      const foreign=await request("/sign-in/email",{email:"attacker@example.test",password},"127.0.0.11","https://foreign.invalid");
      assert.equal(foreign.status,403);
      assert.equal(await auth.api.getSession({headers:new Headers({cookie:"statsarena.session_token=forged"})}),null);
    });
    await t.test("one-time bootstrap enrollment creates a hashed credential and admin role atomically",async()=>{
      const token=await seed("admin@example.test",[],true);
      const result=await acceptInvitation(db,settings,token,{name:"Admin",password});adminId=result.userId;
      const [user]=await db.select().from(authUsers).where(eq(authUsers.id,adminId));assert.equal(user?.isAdmin,true);
      const login=await request("/sign-in/email",{email:"admin@example.test",password},"127.0.0.20");
      const cookie=login.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
      const session=await auth.api.getSession({headers:new Headers({cookie})});assert.equal(session?.user.isAdmin,true);
      assert.equal(reportAccess("/games",true,session.user.isAdmin),"allow");assert.equal(loginDestination(session.user.isAdmin,undefined),"/");
      const [account]=await db.select().from(authAccounts).where(eq(authAccounts.userId,adminId));assert.ok(account?.password);assert.notEqual(account.password,password);
      await assert.rejects(()=>acceptInvitation(db,settings,token,{name:"Reused",password}),/sudah dipakai/);
    });
    await t.test("admin invitation binds email and scoped clubs; login sets an HttpOnly session and staff cannot administer",async()=>{
      await assert.rejects(()=>createStaffInvitation(db,settings,"foreign-user","coach@example.test",[grant],[grant]));
      await assert.rejects(()=>createStaffInvitation(db,settings,adminId,"coach@example.test",[{...grant,competitionKey:"IBL:42041"}],[grant]));
      const invite=await createStaffInvitation(db,settings,adminId," COACH@example.test ",[grant],[grant]);
      const token=new URL(invite.url).pathname.split("/").at(-1)!;
      assert.equal((await invitationPreview(db,token)).email,"coach@example.test");
      const result=await acceptInvitation(db,settings,token,{name:"Coach",password});staffId=result.userId;
      const [user]=await db.select().from(authUsers).where(eq(authUsers.id,staffId));assert.equal(user?.isAdmin,false);
      const login=await request("/sign-in/email",{email:"coach@example.test",password},"127.0.0.12");assert.equal(login.status,200);
      const cookies=login.headers.getSetCookie();assert.ok(cookies.some(c=>/HttpOnly/i.test(c)));assert.ok(cookies.some(c=>/SameSite=Lax/i.test(c)));
      staffCookie=cookies.map(c=>c.split(";")[0]).join("; ");
      const session=await auth.api.getSession({headers:new Headers({cookie:staffCookie})});assert.equal(session?.user.id,staffId);assert.equal(session.user.isAdmin,false);
      assert.equal(reportAccess("/games",true,session.user.isAdmin),"redirect");assert.equal(loginDestination(session.user.isAdmin,"/games"),"/reports");
      const forgedUpdate=await auth.handler(new Request(`${settings.baseURL}/api/auth/update-user`,{method:"POST",headers:{origin:settings.baseURL,cookie:staffCookie,"content-type":"application/json"},body:JSON.stringify({name:"Coach",isAdmin:true})}));
      assert.ok(forgedUpdate.status<500);
      assert.equal((await db.select({isAdmin:authUsers.isAdmin}).from(authUsers).where(eq(authUsers.id,staffId)))[0]?.isAdmin,false,"client profile updates must never grant admin rights");
      const grants=await db.select().from(authClubAccess).where(eq(authClubAccess.userId,staffId));
      const viewer:ReportViewer={id:staffId,name:"Coach",email:user.email,isAdmin:false,grants};
      assert.equal(canReadClub(viewer,grant.competitionKey,grant.clubSourceId),true);
      assert.equal(canReadClub(viewer,grant.competitionKey,"170782"),false);assert.equal(canReadClub(viewer,"IBL:42041",grant.clubSourceId),false);
      await assert.rejects(()=>createStaffInvitation(db,settings,staffId,"another@example.test",[grant],[grant]),/admin/);
      await assert.rejects(()=>revokeClubAccess(db,staffId,grants[0]!.id),/admin/);
    });
    await t.test("failed membership writes roll back newly-created user, password hash and invitation claim",async()=>{
      const token=await seed("rollback@example.test");
      await client.exec("CREATE FUNCTION statsarena.auth_test_fail_grant() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test grant failure'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER auth_test_fail_grant BEFORE INSERT ON statsarena.auth_club_access FOR EACH ROW EXECUTE FUNCTION statsarena.auth_test_fail_grant();");
      await assert.rejects(()=>acceptInvitation(db,settings,token,{name:"Rollback",password}));
      await client.exec("DROP TRIGGER auth_test_fail_grant ON statsarena.auth_club_access; DROP FUNCTION statsarena.auth_test_fail_grant();");
      assert.equal((await db.select().from(authUsers).where(eq(authUsers.email,"rollback@example.test"))).length,0);
      assert.equal((await invitationPreview(db,token)).email,"rollback@example.test");
    });
    await t.test("expired/revoked/wrong-account invitations fail; existing staff can accept another club without resetting password",async()=>{
      const expired=await seed("expired@example.test");await db.update(authInvitations).set({expiresAt:new Date(0)}).where(eq(authInvitations.tokenHash,hashInvitation(expired)));
      await assert.rejects(()=>invitationPreview(db,expired));
      const revoked=await seed("revoked@example.test");const [row]=await db.select().from(authInvitations).where(eq(authInvitations.tokenHash,hashInvitation(revoked)));await revokeInvitation(db,adminId,row!.id);await assert.rejects(()=>invitationPreview(db,revoked));
      const extra={...grant,clubSourceId:"170782"};const token=await seed("coach@example.test",[extra]);
      await assert.rejects(()=>acceptInvitation(db,settings,token,{existingUserId:adminId}),/email/);
      await assert.rejects(()=>acceptInvitation(db,settings,token,{name:"Overwrite",password}),/sudah memiliki akun/);
      await acceptInvitation(db,settings,token,{existingUserId:staffId});
      assert.equal((await db.select().from(authClubAccess).where(eq(authClubAccess.userId,staffId))).length,2);
    });
    await t.test("access revocation applies with the same session, sign-out invalidates it, and login attempts are rate-limited",async()=>{
      const grants=await db.select().from(authClubAccess).where(eq(authClubAccess.userId,staffId));
      for(const g of grants)await revokeClubAccess(db,adminId,g.id);
      assert.equal((await db.select().from(authClubAccess).where(eq(authClubAccess.userId,staffId))).length,0);
      assert.ok(await auth.api.getSession({headers:new Headers({cookie:staffCookie})}));
      const out=await auth.handler(new Request(`${settings.baseURL}/api/auth/sign-out`,{method:"POST",headers:{origin:settings.baseURL,cookie:staffCookie,"content-type":"application/json"},body:"{}"}));assert.equal(out.status,200);
      assert.equal(await auth.api.getSession({headers:new Headers({cookie:staffCookie})}),null);
      let status=0;for(let n=0;n<6;n++)status=(await request("/sign-in/email",{email:"nobody@example.test",password},"127.0.0.90")).status;
      assert.equal(status,429);
    });
  } finally {await client.close();}
});
test("auth route allowlist and return destinations reject external redirects and unrelated APIs",()=>{
  for(const value of ["https://foreign.invalid","//foreign.invalid","/\\foreign.invalid","/login?next=https://foreign.invalid",["/reports"]])assert.equal(safeReturnTo(value),"/reports");
  assert.equal(safeReturnTo("/reports/rajawali-medan?section=players"),"/reports/rajawali-medan?section=players");
  for(const path of ["/login","/auth/continue","/api/auth/sign-in/email",`/invite/${"A".repeat(43)}`])assert.equal(reportAccess(path,true),"allow");
  for(const path of ["/api/private","/admin/users","/invite/invalid"])assert.equal(reportAccess(path,true),"deny");
});
test("login landing uses the verified role and preserves permitted deep links without open redirects",()=>{
  assert.equal(loginDestination(true,undefined),"/");assert.equal(loginDestination(true,"/reports"),"/");
  assert.equal(loginDestination(false,undefined),"/reports");
  for(const path of ["/","/games","/players/170782","/teams/126042","/standings","/review","/admin/access","/reports/demo-match"]){
    assert.equal(loginDestination(true,path),path);assert.equal(loginDestination(false,path),"/reports");
    assert.equal(reportAccess(path,true,true),"allow");assert.equal(reportAccess(path,true,false),"redirect");
  }
  const report="/reports/dewa-united-banten?section=players&sort=gameScore&order=desc";
  for(const role of [true,false])assert.equal(loginDestination(role,report),report);
  for(const value of ["https://foreign.invalid","//foreign.invalid","/\\foreign.invalid",["/"]]){
    assert.equal(loginDestination(true,value),"/");assert.equal(loginDestination(false,value),"/reports");assert.equal(loginContinuation(value),"/auth/continue");
  }
  assert.equal(loginContinuation("/games?competition=49607"),"/auth/continue?next=%2Fgames%3Fcompetition%3D49607");
});
