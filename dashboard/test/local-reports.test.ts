import assert from "node:assert/strict";
import test from "node:test";
import { loadLocalCompetition, localClubCards, localClubReport } from "../lib/reports/local-competition";
import { buildClubShotCharts, parseSingleClubShotFilters, selectClubShots } from "../lib/reports/club-shot-chart";
import { buildClubRotations } from "../lib/reports/club-rotation";
import { playerDevelopment } from "../lib/reports/player-development";
import { clubHref, buildScopedClubReport } from "../lib/reports/club-report";
import { reportAccess } from "../lib/reports/reports-access";
import snapshot from "../lib/reports/data/IBL-50231.json";

const data = loadLocalCompetition();
test("local 2026 catalog includes all 10 clubs, seven completed games, and 20 scoped fixtures", () => {
  assert.equal(data.competition.key,"IBL:50231");
  assert.equal(data.clubs.length,10); assert.equal(data.games.length,7); assert.equal(data.fixtures.length,20);
  assert.equal(data.clubs.some(c=>c.sourceId==="126038"),false,"2025 Bima must not be invented as a 2026 entrant");
  const cards=localClubCards(data);
  assert.equal(cards.reduce((n,c)=>n+c.games,0),14); assert.equal(cards.reduce((n,c)=>n+c.wins,0),7); assert.equal(cards.reduce((n,c)=>n+c.losses,0),7);
  assert.equal(localClubReport("does-not-exist"),null);
  for(const c of cards){ const bundle=localClubReport(c.slug,data)!;
    assert.equal(bundle.report.basePath,c.href); assert.equal(bundle.report.games.length,c.games);
    assert.ok(bundle.report.games.every(g=>g.competition.key==="IBL:50231"&&g.teams.some(t=>t.sourceId===c.sourceId)));
    assert.ok(bundle.report.players.every(p=>p.games.every(g=>bundle.report.scope.gameIds.includes(g.gameId))));
    assert.equal(clubHref("players",bundle.report.players[0]!.sourceId,bundle.report.basePath).startsWith(`${c.href}?`),true);
  }
});

test("home/away score orientation, observed fixture order, and single-game development remain correct", () => {
  const dewa=localClubReport("dewa-united-banten")!.report;
  assert.deepEqual(dewa.games.map(g=>[g.fixture.sourceId,g.team.stats.points,g.opponent.stats.points,g.result]),[["2938930",61,59,"W"],["2945706",66,57,"W"]]);
  assert.equal(dewa.perGame.points,63.5); assert.equal(dewa.wins,2);
  const bogor=localClubReport("bogor-hornbills")!.report;
  assert.deepEqual(bogor.games.map(g=>g.fixture.sourceId),["2938926","2945707"]);
  const rjm=localClubReport("rajawali-medan")!.report;
  assert.equal(rjm.totals.points,47); assert.equal(rjm.opponentTotals.points,73);
  const d=playerDevelopment(rjm,rjm.players[0]!);
  assert.equal(d.comparable,false); assert.equal(d.first,undefined); assert.ok(d.second);
  assert.ok(Object.values(d.changes).every(v=>v===null));
});

test("every 2026 club shot dataset reconciles both game/player totals and selects one source canvas", () => {
  let charts=0;
  for(const c of data.clubs){const b=localClubReport(c.slug)!;
    for(const g of buildClubShotCharts(b.report,b.shotsInput)){assert.equal(g.status,"ready",g.problems.join(" "));charts++;}
    const selected=selectClubShots(b.report,parseSingleClubShotFilters(b.report,{}),b.shotsInput);
    assert.equal(selected.charts.length,1);
    assert.equal(selected.summary!.attempts,b.report.games[0]!.team.stats.fieldGoalsAttempted);
  }
  assert.equal(charts,14);
});

test("rotation home/away reconstruction stays validated; source issues preserve other games and raw stats", () => {
  const home=localClubReport("satya-wacana-salatiga")!;
  const rotations=buildClubRotations(home.report,home.rotationInput);
  assert.ok(rotations.every(g=>g.status==="ready"));
  const actual=rotations[1]!;
  assert.equal(actual.status,"ready");
  if(actual.status!=="ready")return;
  assert.equal(actual.stints.reduce((n,s)=>n+s.pointsFor,0),58);
  assert.equal(actual.stints.reduce((n,s)=>n+s.pointsAgainst,0),78);
  assert.equal(actual.durationSeconds,2400);
  const bogor=localClubReport("bogor-hornbills")!;
  const split=buildClubRotations(bogor.report,bogor.rotationInput);
  assert.equal(split[0]!.status,"ready"); assert.equal(split[1]!.status,"partial");
  assert.equal(bogor.report.games[1]!.team.stats.points,73);
  const rjm=localClubReport("rajawali-medan")!;
  const game=buildClubRotations(rjm.report,rjm.rotationInput)[0]!;
  assert.equal(game.status,"ready");
  if(game.status==="ready"){
    assert.equal(game.ratingContext.status,"ready");
    assert.ok(game.stints.some(s=>s.from===s.to&&s.pointsFor===0&&s.pointsAgainst===0),"keep statistical activity even when no time or points elapse");
    assert.equal(game.ratingContext.totalFor!.freeThrowAttempts,rjm.report.games[0]!.team.stats.freeThrowAttempts);
    assert.ok(game.players.some(p=>p.onRating.netRating!==null));
  }
});

test("verified name aliases unlock both Hangtuah games without accepting foreign event names or unsupported identity evidence",()=>{
  const bundle=localClubReport("hangtuah-jg-liem-jakarta")!;
  const games=buildClubRotations(bundle.report,bundle.rotationInput);
  assert.ok(games.every(g=>g.status==="ready"));
  const first=games[0]!;if(first.status!=="ready")return;
  assert.equal(first.players.length,12);assert.equal(first.lineups.length,24);
  assert.equal(first.stints.reduce((n,s)=>n+s.pointsFor,0),62);assert.equal(first.stints.reduce((n,s)=>n+s.pointsAgainst,0),58);
  assert.equal(first.ratingContext.status,"ready");
  assert.ok(first.players.every(p=>Math.abs(p.minuteDifferenceSeconds)<=1&&p.on.margin===p.officialPlusMinus));
  for(const kind of ["event-name","jersey","name-evidence"]){
    const altered=structuredClone(snapshot);const game=altered.games.find(g=>g.portal.fixture.sourceId==="2945705")!;
    const team=game.rotation.teams.find(t=>t.teamSourceId===bundle.club.sourceId)!;
    const player=team.players.find(p=>p.sourceId==="2384249")!;
    const event=game.rotation.events.find(e=>e.tno===team.clubLocalTeamKey&&e.pno===player.localKey)!;
    if(kind==="event-name")event.player="Foreign Player";
    else if(kind==="jersey")event.shirtNumber="999";
    else player.nameEvidence.internationalFirstName="Wrong";
    const modified=localClubReport(bundle.club.slug,loadLocalCompetition(altered))!;
    const results=buildClubRotations(modified.report,modified.rotationInput);
    assert.equal(results[0]!.status,"partial",kind);assert.equal(results[1]!.status,"ready");
  }

});

test("split same-clock substitutions recover Dewa durations and score without guessing free-throw lineup",()=>{
  const bundle=localClubReport("dewa-united-banten")!;
  const results=buildClubRotations(bundle.report,bundle.rotationInput);
  const game=results[0]!;
  assert.equal(game.status,"ready");assert.equal(results[1]!.status,"partial");
  if(game.status!=="ready")return;
  assert.equal(game.lineups.length,21);assert.equal(game.durationSeconds,2400);
  assert.equal(game.stints.reduce((n,s)=>n+s.pointsFor,0),61);
  assert.equal(game.stints.reduce((n,s)=>n+s.pointsAgainst,0),59);
  assert.ok(game.stints.every(s=>s.playerIds.length===5));
  assert.ok(game.players.every(p=>Math.abs(p.minuteDifferenceSeconds)<=1&&p.on.margin===p.officialPlusMinus));
  assert.equal(game.ratingContext.status,"partial");
  assert.deepEqual(game.ratingContext.ambiguousSourceSequences,[344]);
  assert.deepEqual(game.ratingContext.issues,["Event statistik di sela pasangan pergantian pada jam yang sama belum memiliki lineup yang pasti."]);
  assert.ok(game.players.every(p=>p.onRating.netRating===null&&p.offRating.netRating===null));
});

test("split substitutions still reject changed clocks, scores, unsupported actors and missing partners",()=>{
  for(const kind of ["clock","score","actor","duplicate","missing-in"]){
    const altered=structuredClone(snapshot);
    const raw=altered.games.find(g=>g.portal.fixture.sourceId==="2938930")!.rotation;
    const ft=raw.events.find(e=>e.sourceSequence===344)!;
    const incoming=raw.events.find(e=>e.sourceSequence===343)!;
    if(kind==="clock")incoming.clock="01:42:00";
    else if(kind==="score"){ft.s1="31";ft.success=1;}
    else if(kind==="actor"){
      const outgoing=raw.events.find(e=>e.sourceSequence===346)!;
      ft.pno=outgoing.pno;ft.player=outgoing.player;ft.shirtNumber=outgoing.shirtNumber;
    }else if(kind==="duplicate")incoming.subType="out";
    else {incoming.actionType="timeout";incoming.pno=0;}
    const bundle=localClubReport("dewa-united-banten",loadLocalCompetition(altered))!;
    const game=buildClubRotations(bundle.report,bundle.rotationInput)[0]!;
    assert.equal(game.status,"partial",kind);
    if(game.status==="partial")assert.match(game.issues[0]!,{
      clock:/Pergantian belum lengkap/,score:/Skor berubah sebelum/,actor:/kedua lineup/,
      duplicate:/masuk\/keluar/,"missing-in":/Pergantian belum lengkap/,
    }[kind]!);
  }
});

test("foreign competition/fixtures, duplicate clubs and slugs, and forged completed scores are rejected", () => {
  assert.throws(()=>loadLocalCompetition({...snapshot,competition:{...snapshot.competition,key:"IBL:42041"}}));
  assert.throws(()=>loadLocalCompetition({...snapshot,clubs:[...snapshot.clubs,snapshot.clubs[0]]}));
  assert.throws(()=>loadLocalCompetition({...snapshot,clubs:snapshot.clubs.map((c,i)=>i===1?{...c,slug:snapshot.clubs[0]!.slug}:c)}));
  assert.throws(()=>loadLocalCompetition({...snapshot,fixtures:snapshot.fixtures.map((f,i)=>i===0?{...f,homeScore:999}:f)}));
  const report=localClubReport(data.clubs[0]!.slug)!.report;
  assert.throws(()=>buildScopedClubReport({...report,scope:{...report.scope,gameIds:["foreign"]}}));
});

test("a registered club with no completed local games stays empty, never a zero-stat played game", () => {
  const altered=loadLocalCompetition({...snapshot,games:[]});
  const b=localClubReport(altered.clubs[0]!.slug,altered)!;
  assert.equal(b.report.games.length,0); assert.equal(b.report.players.length,0); assert.equal(b.report.perGame.points,null);
  assert.equal(localClubCards(altered)[0]!.games,0);
});

test("report-only deployment redirects non-admin dashboard routes while retaining scoped report routes and assets", () => {
  assert.equal(reportAccess("/",true),"redirect"); assert.equal(reportAccess("/reports",true),"allow");
  for(const c of data.clubs) assert.equal(reportAccess(`/reports/${c.slug}`,true),"allow");
  for(const path of ["/games","/players","/teams","/standings","/review","/admin/access","/reports/bima-perkasa","/reports/demo-match"]){assert.equal(reportAccess(path,true),"redirect",path);assert.equal(reportAccess(path,true,true),"allow");}
  for(const path of ["/api/games","/_next/data/build/games.json","/reports/rajawali-medan/private","/reports2"]){assert.equal(reportAccess(path,true),"deny",path);assert.equal(reportAccess(path,false),"allow");}
  assert.equal(reportAccess("/reports/new-club-from-neon",true),"allow","server resolves dynamic club membership and returns 404 for unknown or unauthorized clubs");
  for(const path of ["/_next/static/chunk.js","/reports/genius-basketball-court.jpg","/icon.svg"])assert.equal(reportAccess(path,true),"allow");
});
