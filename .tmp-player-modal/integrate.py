from pathlib import Path
import re

root = Path(__file__).resolve().parent.parent
for name in ['stats.html', 'draftActif.html', 'classement.html']:
    path = root / name
    text = path.read_text(encoding='utf-8')
    start = text.index('<div id="careerStatsModal"')
    depth = 0
    for tag in re.finditer(r'</?div\b[^>]*>', text[start:]):
        depth += -1 if tag.group().startswith('</') else 1
        if depth == 0:
            end = start + tag.end()
            break
    text = text[:start] + '<!-- Shared player profile, mounted by careerModal.js. -->\n    <div id="careerStatsModal" class="modal"></div>' + text[end:]
    text = re.sub(r'\s*<link rel="stylesheet" href="career-modal.css"\s*/?>', '', text)
    text = text.replace('</head>', '    <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@700;800&display=swap" rel="stylesheet">\n    <link rel="stylesheet" href="career-modal.css">\n</head>')
    text = text.replace('<script defer src="careerFetch.js"></script>', '<script defer src="careerFetch.js"></script>\n    <script defer src="careerModal.js"></script>')
    if name == 'classement.html':
        text = text.replace('<script defer src="careerFetch.js">', '<script defer src="teamColors.js"></script>\n    <script defer src="careerFetch.js">')
        text = text.replace('<script defer src="careerModal.js"></script>', '<script defer src="careerModal.js"></script>\n    <script defer src="careerTeamLogo.js"></script>\n    <script defer src="careerTotals.js"></script>')
    path.write_text(text, encoding='utf-8', newline='')

for name in ['index.js', 'draftActif.js', 'classement.js']:
    path = root / name
    text = path.read_text(encoding='utf-8')
    start = text.index('async function showCareerStats(')
    end = text.index('function filterCareerStats(', start)
    player = ' currentPlayerId = playerId; currentGameLogData = null;' if name == 'index.js' else ''
    text = text[:start] + '''async function showCareerStats(playerId, playerName, isGoalie = false) {
    currentCareerData = null;
    return fzOpenCareerModal(playerId, playerName, {
        onData(data) { currentCareerData = data;''' + player + ''' },
        renderStats: filterCareerStats
    });
}

''' + text[end:]
    start = text.index('function closeCareerModal(')
    end = text.index('}', start) + 1
    extra = ' currentGameLogData = null;' if name == 'index.js' else ''
    text = text[:start] + 'function closeCareerModal() {\n    fzCloseCareerModal();\n    currentCareerData = null;' + extra + '\n}' + text[end:]
    path.write_text(text, encoding='utf-8', newline='')
