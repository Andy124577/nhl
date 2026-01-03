# Head-to-Head Mode Testing Guide

This document outlines the testing procedures for the newly implemented Head-to-Head (H2H) pool mode.

## Features Implemented

### 1. Pool Configuration (pool.html)
- ✅ Radio buttons for mode selection (Cumulative / Head-to-Head)
- ✅ Checkbox for enabling/disabling trades
- ✅ Validation: H2H mode requires even number of participants
- ✅ Settings saved at pool creation and cannot be changed after

### 2. Server-side H2H Logic (server.js)
- ✅ H2H data structure initialization on pool creation
- ✅ Automatic Week 1 matchup generation when draft completes
- ✅ Season starts on next Monday at 00:00:00
- ✅ Weekly matchup generation with random shuffling
- ✅ Team points calculation (skaters + goalies)
- ✅ Standings tracking (W-L-T-PF-PA)
- ✅ Manual finalization endpoint: POST /h2h/finalize-week
- ✅ Automatic week finalization (runs every 6 hours)

### 3. Adaptive Classement Interface (classement.html/js/css)
- ✅ Detects pool mode and shows appropriate interface
- ✅ Three-tab H2H interface:
  - **Duel en cours**: Live matchup cards with current scores
  - **Classement**: W-L-T-PF-PA standings table
  - **Historique**: Past weeks with final results
- ✅ Visual indicators (leading team, winners, ties)
- ✅ Fully responsive design

### 4. Trade Visibility Control (poolSelector.js)
- ✅ Hides/shows "Échanges" link based on pool's allowTrades setting
- ✅ Works across all pages with pool selector
- ✅ Defaults to true for backward compatibility

---

## Test Scenarios

### Test 1: Pool Creation - H2H Mode
**Steps:**
1. Navigate to pool.html
2. Fill in pool name and select max players (must be EVEN number)
3. Select "Head-to-Head" mode
4. Check/uncheck "Autoriser les échanges de joueurs"
5. Create pool

**Expected Results:**
- Warning appears if odd number of players selected with H2H mode
- Pool is created successfully with even number
- Pool data includes `poolMode: 'head-to-head'` and `allowTrades` setting
- `h2hData` structure is initialized with empty arrays

**Verification:**
```javascript
// Check in draft data
{
  poolMode: 'head-to-head',
  allowTrades: true/false,
  h2hData: {
    currentWeek: 1,
    weekStart: null,
    matchups: [],
    standings: {},
    matchupHistory: []
  }
}
```

---

### Test 2: Draft Completion - Week 1 Generation
**Steps:**
1. Create an H2H pool with even number of teams
2. Complete the draft (all teams select all required players)

**Expected Results:**
- Week 1 matchups are automatically generated
- `weekStart` is set to next Monday 00:00:00
- `currentWeek` is set to 1
- `matchups[0]` contains random pairings of all teams
- `standings` object initialized with all teams at 0-0-0

**Verification:**
```javascript
// Check h2hData after draft completion
{
  currentWeek: 1,
  weekStart: "2026-01-06T05:00:00.000Z", // Next Monday
  matchups: [
    [
      { team1: "Team A", team2: "Team B", team1Points: 0, team2Points: 0, winner: null, weekNumber: 1 },
      { team1: "Team C", team2: "Team D", team1Points: 0, team2Points: 0, winner: null, weekNumber: 1 }
    ]
  ],
  standings: {
    "Team A": { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
    "Team B": { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
    // ... etc
  }
}
```

---

### Test 3: Classement Interface - H2H Display
**Steps:**
1. Create and complete an H2H pool draft
2. Navigate to classement.html
3. Select the H2H pool from dropdown

**Expected Results:**
- Cumulative interface is hidden
- H2H interface is displayed
- Sub-navigation shows three tabs
- "Duel en cours" tab is active by default
- Current week matchups are displayed with live scores
- Team with higher score has green background and is scaled up

**UI Elements to Check:**
- ✅ Week number displayed (e.g., "Semaine 1")
- ✅ Each matchup card shows: Team1 vs Team2
- ✅ Live scores from current player stats
- ✅ "VS" separator between teams
- ✅ Leading team highlighted in green

---

### Test 4: H2H Standings Tab
**Steps:**
1. In classement.html with H2H pool selected
2. Click "Classement" tab

**Expected Results:**
- Table displays all teams
- Columns: POS, Équipe, V (wins), D (losses), N (ties), PF (points for), PA (points against), DIFF
- Teams sorted by wins (descending), then by differential
- Positive differentials in green, negative in red
- All values start at 0 before first week finalization

---

### Test 5: Manual Week Finalization
**Steps:**
1. Wait for some games to be played (or manually update player stats)
2. Make POST request to finalize week:
```bash
curl -X POST http://localhost:3000/h2h/finalize-week \
  -H "Content-Type: application/json" \
  -d '{"poolName": "YOUR_POOL_NAME"}'
```

**Expected Results:**
- Current week matchups calculate final scores
- Winners determined (or ties if equal)
- Standings updated (W/L/T, PF/PA)
- Completed week moved to `matchupHistory`
- `currentWeek` incremented by 1
- New matchups generated for next week
- `weekStart` advanced by 7 days
- Socket event emitted: `h2hWeekFinalized`

**Verification:**
```javascript
// Response should include:
{
  message: "Week 1 finalized successfully",
  previousWeek: 1,
  currentWeek: 2,
  results: [ /* array of matchups with winners */ ],
  standings: { /* updated standings */ }
}

// Check h2hData:
{
  currentWeek: 2,
  matchupHistory: [
    {
      weekNumber: 1,
      matchups: [ /* completed matchups with winners */ ],
      completedDate: "2026-01-13T..."
    }
  ],
  matchups: [
    [ /* week 1 - now in history */ ],
    [ /* week 2 - new matchups */ ]
  ]
}
```

---

### Test 6: H2H History Tab
**Steps:**
1. After finalizing at least one week
2. Click "Historique" tab in classement.html

**Expected Results:**
- Week history cards displayed (most recent first)
- Each card shows week number
- Matchups display final scores
- Winner teams highlighted in green
- Trophy emoji (🏆) next to winner
- Ties show "🤝 Égalité" badge
- Completed matchups have green left border

---

### Test 7: Automatic Week Finalization
**Setup:**
1. Create H2H pool and complete draft
2. Manually set `weekStart` to 8+ days ago (simulate past week):
```javascript
// In draftData.json
"h2hData": {
  "weekStart": "2025-12-25T00:00:00.000Z",  // 8 days ago
  ...
}
```
3. Restart server or wait for 6-hour check

**Expected Results:**
- Server startup logs: "🔍 Checking for completed H2H weeks on startup..."
- Auto-finalization triggered: "🔔 Auto-finalizing Week X for pool: ..."
- Week finalized automatically
- New matchups generated
- Socket event emitted: `h2hWeekAutoFinalized`

**Console Logs to Check:**
```
🔍 Checking for completed H2H weeks on startup...
🔔 Auto-finalizing Week 1 for pool: TestPool
✅ Week 1 finalized, advanced to Week 2
💾 H2H data saved after auto-finalization
✅ H2H auto-finalization scheduler initialized (checks every 6 hours)
```

---

### Test 8: Trade Link Visibility
**Test 8a: Trades Enabled**
1. Create pool with "Autoriser les échanges" checked
2. Navigate to any page (index, pool, draft, classement, etc.)
3. Select the pool from dropdown

**Expected Results:**
- "Échanges" link is visible in navbar

**Test 8b: Trades Disabled**
1. Create pool with "Autoriser les échanges" unchecked
2. Navigate to any page
3. Select the pool from dropdown

**Expected Results:**
- "Échanges" link is hidden in navbar
- Link with `id="trade-link"` has `display: none`

**Test 8c: No Pool Selected**
1. Clear pool selection (select "-- Aucun pool --")

**Expected Results:**
- "Échanges" link is hidden

---

### Test 9: Mode Detection in Classement
**Test 9a: Cumulative Pool**
1. Create cumulative pool (or use existing pool created before H2H feature)
2. Navigate to classement.html
3. Select cumulative pool

**Expected Results:**
- H2H content is hidden (`#h2hContent` has `display: none`)
- Cumulative content is displayed (`#cumulativeContent` shown)
- Standard points table is rendered

**Test 9b: H2H Pool**
1. Select H2H pool in classement.html

**Expected Results:**
- Cumulative content is hidden
- H2H content is displayed
- Three tabs visible and functional

---

### Test 10: Points Calculation Accuracy
**Setup:**
1. Create H2H pool with 2 teams
2. Each team has known players with specific stats

**Verification:**
Manually calculate expected points:
- Skaters (offensive/defensive/rookie): Sum of `points` stat
- Goalies: `wins * 2`
- Team total = All player points combined

**Compare with displayed scores in "Duel en cours" tab**

Example:
```
Team A:
- Player1 (skater): 50 points
- Player2 (skater): 40 points
- Goalie1: 20 wins = 40 points
Team A Total: 130 points

Team B:
- Player3 (skater): 45 points
- Player4 (skater): 35 points
- Goalie2: 18 wins = 36 points
Team B Total: 116 points

Expected Display:
Team A: 130 (leading, green background)
Team B: 116
```

---

### Test 11: Standings Sorting
**After finalizing multiple weeks:**
1. Navigate to "Classement" tab
2. Verify sorting logic

**Expected Sorting:**
1. Primary: Most wins (descending)
2. Secondary: Best differential (descending)

Example:
```
POS  Team      V  D  N   PF   PA   DIFF
1    Team A    3  0  0   450  320  +130
2    Team B    2  1  0   410  380  +30
3    Team C    2  1  0   400  390  +10   <- Same W-L as Team B, lower diff
4    Team D    0  3  0   300  470  -170
```

---

### Test 12: Responsive Design
**Mobile Testing:**
1. Resize browser to mobile width (< 768px)
2. Navigate through classement.html with H2H pool

**Expected Results:**
- Sub-navigation stacks vertically
- Matchup cards stack vertically (teams on top of each other)
- "VS" rotates 90 degrees
- History matchups stack vertically
- Badges move from absolute to static positioning
- All tables remain readable and scrollable

---

### Test 13: Edge Cases

**Test 13a: Odd Number of Teams (Validation)**
1. Try to create H2H pool with 3 teams

**Expected:**
- Warning message appears
- Pool creation blocked (alert shown)

**Test 13b: No Matchups Available**
1. Try to finalize week before draft is complete

**Expected:**
- Error response: "No matchups found for current week"

**Test 13c: Pool Not Found**
1. POST to /h2h/finalize-week with invalid pool name

**Expected:**
- 404 error: "Pool not found"

**Test 13d: Non-H2H Pool Finalization**
1. Try to finalize week for cumulative pool

**Expected:**
- 400 error: "Pool is not in Head-to-Head mode"

---

## API Endpoints Reference

### POST /h2h/finalize-week
Manually finalize current week and advance to next week.

**Request:**
```json
{
  "poolName": "TestPool"
}
```

**Response (Success):**
```json
{
  "message": "Week 1 finalized successfully",
  "previousWeek": 1,
  "currentWeek": 2,
  "results": [
    {
      "team1": "Team A",
      "team2": "Team B",
      "team1Points": 130,
      "team2Points": 116,
      "winner": "Team A",
      "weekNumber": 1
    }
  ],
  "standings": {
    "Team A": { "wins": 1, "losses": 0, "ties": 0, "pointsFor": 130, "pointsAgainst": 116 },
    "Team B": { "wins": 0, "losses": 1, "ties": 0, "pointsFor": 116, "pointsAgainst": 130 }
  }
}
```

---

## Socket Events

### Client Events to Listen For:
1. **h2hWeekFinalized** - Emitted when week is manually finalized
2. **h2hWeekAutoFinalized** - Emitted when week is automatically finalized
3. **draftComplete** - Triggers Week 1 matchup generation for H2H pools

---

## Data Structure Reference

### h2hData Object
```javascript
{
  currentWeek: 1,                    // Current week number
  weekStart: "2026-01-06T00:00:00Z", // ISO string, Monday 00:00:00
  matchups: [                         // Array of week arrays
    [                                 // Week 1
      {
        team1: "Team A",
        team2: "Team B",
        team1Points: 0,
        team2Points: 0,
        winner: null,                 // null | "Team A" | "Team B" | "tie"
        weekNumber: 1
      }
    ]
  ],
  standings: {                        // Team records
    "Team A": {
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      pointsAgainst: 0
    }
  },
  matchupHistory: [                   // Completed weeks
    {
      weekNumber: 1,
      matchups: [ /* ... */ ],
      completedDate: "2026-01-13T12:00:00Z"
    }
  ]
}
```

---

## Known Limitations & Future Enhancements

### Current Limitations:
1. Week schedule is fixed (7 days, Mon-Sun) - no custom schedules
2. Matchups are fully random each week - no bracket/playoff system
3. Ties count as 0.5 win for both teams in most systems - here they're tracked separately
4. No manual matchup editing - all auto-generated
5. Points calculation based on cumulative season stats, not weekly delta

### Potential Enhancements:
1. Add "reset week stats" to track only current week performance
2. Implement playoff system after regular season
3. Add manual matchup override for commissioners
4. Add H2H analytics (head-to-head records between teams)
5. Email notifications when week ends
6. Customizable week duration (5 days, 7 days, etc.)
7. Mid-week score updates via WebSocket

---

## Troubleshooting

### Issue: Matchups not generating
**Check:**
- Draft is complete (all teams have full rosters)
- Pool mode is 'head-to-head'
- Even number of active teams
- Server logs for errors

### Issue: Scores showing as 0
**Check:**
- Player stats have been refreshed (`/refresh-stats`)
- Players are in `fullPlayerData` or `goalieData`
- Team rosters contain player objects, not just names

### Issue: Week not auto-finalizing
**Check:**
- Server has been running for 6+ hours OR restart server
- `weekStart` is more than 7 days ago
- Current week has matchups
- Server logs for "🔍 Running periodic check..."

### Issue: Trade link not hiding
**Check:**
- Pool has `allowTrades: false` in data
- `poolSelector.js` is loaded on the page
- Trade link has `id="trade-link"`
- Browser console for JavaScript errors

---

## Testing Checklist

- [ ] Pool creation with H2H mode
- [ ] Pool creation validation (odd teams blocked)
- [ ] allowTrades setting saved correctly
- [ ] Week 1 auto-generation on draft complete
- [ ] weekStart set to next Monday
- [ ] Classement shows H2H interface for H2H pools
- [ ] Classement shows cumulative interface for cumulative pools
- [ ] "Duel en cours" displays live matchups
- [ ] Leading team highlighted correctly
- [ ] "Classement" tab shows standings
- [ ] Standings sorted correctly (wins, then diff)
- [ ] "Historique" tab shows completed weeks
- [ ] Winners marked with trophy emoji
- [ ] Ties marked with égalité badge
- [ ] Manual week finalization works
- [ ] Standings updated after finalization
- [ ] New week matchups generated
- [ ] weekStart advanced by 7 days
- [ ] Automatic finalization on server startup
- [ ] Automatic finalization runs every 6 hours
- [ ] Trade link visible when allowTrades=true
- [ ] Trade link hidden when allowTrades=false
- [ ] Trade link hidden when no pool selected
- [ ] Points calculation accurate (skaters + goalies)
- [ ] Responsive design on mobile
- [ ] All socket events emitted correctly

---

## Test Data Setup Script

For quick testing, you can manually edit `draftData.json`:

```javascript
// Set week to past date (for auto-finalization testing)
"h2hData": {
  "weekStart": "2025-12-25T00:00:00.000Z",  // 8+ days ago
  "currentWeek": 1,
  // ... rest of data
}

// Disable trades
"allowTrades": false,

// Add test matchups manually
"matchups": [
  [
    {
      "team1": "TeamA",
      "team2": "TeamB",
      "team1Points": 0,
      "team2Points": 0,
      "winner": null,
      "weekNumber": 1
    }
  ]
]
```

---

## Success Criteria

The Head-to-Head mode is considered fully functional when:
1. ✅ Pools can be created in H2H mode with even teams
2. ✅ Week 1 matchups generate automatically on draft completion
3. ✅ Classement page displays appropriate interface based on mode
4. ✅ Live scores update correctly in "Duel en cours"
5. ✅ Standings track W-L-T-PF-PA accurately
6. ✅ Manual finalization endpoint works
7. ✅ Automatic finalization runs on schedule
8. ✅ Trade link visibility controlled by setting
9. ✅ All three H2H tabs functional and styled
10. ✅ Responsive design works on mobile devices

---

**Document Version:** 1.0
**Last Updated:** 2026-01-03
**Implementation Status:** Complete ✅
