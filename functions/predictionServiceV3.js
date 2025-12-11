/**
 * E-Cauri App - Service de Prédiction IA V3
 * Utilise Claude API (avec Extended Thinking) et DeepSeek (avec Thinking)
 * 
 * Architecture:
 * - Claude (claude-sonnet-4-20250514) avec extended thinking pour l'analyse approfondie
 * - DeepSeek (deepseek-reasoner) avec thinking pour la validation croisée
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";

// ============== LISTE DES BOOKMAKERS API-FOOTBALL ==============

const API_FOOTBALL_BOOKMAKERS = [
    { id: 1, name: "10Bet", key: "10bet" },
    { id: 2, name: "Marathonbet", key: "marathonbet" },
    { id: 3, name: "5Dimes", key: "5dimes" },
    { id: 4, name: "Pinnacle", key: "pinnacle" },
    { id: 5, name: "William Hill", key: "williamhill" },
    { id: 6, name: "Bwin", key: "bwin" },
    { id: 7, name: "Ladbrokes", key: "ladbrokes" },
    { id: 8, name: "Bet365", key: "bet365" },
    { id: 9, name: "188Bet", key: "188bet" },
    { id: 10, name: "Betsson", key: "betsson" },
    { id: 11, name: "Betfair", key: "betfair" },
    { id: 12, name: "Betfair Exchange", key: "betfair_exchange" },
    { id: 13, name: "Betfred", key: "betfred" },
    { id: 14, name: "Betway", key: "betway" },
    { id: 15, name: "Boylesports", key: "boylesports" },
    { id: 16, name: "BetBright", key: "betbright" },
    { id: 17, name: "Betway", key: "betway" },
    { id: 18, name: "Tipico", key: "tipico" },
    { id: 19, name: "Sportingbet", key: "sportingbet" },
    { id: 20, name: "Unibet", key: "unibet" },
    { id: 21, name: "Interwetten", key: "interwetten" },
    { id: 22, name: "888Sport", key: "888sport" },
    { id: 23, name: "NordicBet", key: "nordicbet" },
    { id: 24, name: "Jetbull", key: "jetbull" },
    { id: 25, name: "Betclic", key: "betclic" },
    { id: 26, name: "Unibet", key: "unibet" },
    { id: 27, name: "Dafabet", key: "dafabet" },
    { id: 28, name: "Coral", key: "coral" },
    { id: 29, name: "Paddy Power", key: "paddypower" },
    { id: 30, name: "SkyBet", key: "skybet" },
    { id: 31, name: "188Bet", key: "188bet" },
    { id: 32, name: "Sbobet", key: "sbobet" },
    { id: 33, name: "Matchbook", key: "matchbook" },
    { id: 34, name: "Betvictor", key: "betvictor" },
    { id: 35, name: "22bet", key: "22bet" },
    { id: 36, name: "1xBet", key: "1xbet" },
    { id: 37, name: "Fonbet", key: "fonbet" },
    { id: 38, name: "Melbet", key: "melbet" },
    { id: 39, name: "Betwinner", key: "betwinner" },
    { id: 40, name: "Parimatch", key: "parimatch" },
    { id: 41, name: "Leonbets", key: "leonbets" },
    { id: 42, name: "GGBet", key: "ggbet" },
    { id: 43, name: "Mostbet", key: "mostbet" },
    { id: 44, name: "1win", key: "1win" },
    { id: 45, name: "Linebet", key: "linebet" },
    { id: 46, name: "Betano", key: "betano" },
    { id: 47, name: "Superbet", key: "superbet" },
    { id: 48, name: "Sportaza", key: "sportaza" },
    { id: 49, name: "BetWay Africa", key: "betway_africa" },
    { id: 50, name: "Betika", key: "betika" },
    { id: 51, name: "SportyBet", key: "sportybet" },
    { id: 52, name: "Bet9ja", key: "bet9ja" },
    { id: 53, name: "Mozzart", key: "mozzart" },
    { id: 54, name: "Premier Bet", key: "premierbet" },
    { id: 55, name: "ZEbet", key: "zebet" },
    { id: 56, name: "NetBet", key: "netbet" },
    { id: 57, name: "PMU", key: "pmu" },
    { id: 58, name: "Winamax", key: "winamax" },
    { id: 59, name: "ParionsSport", key: "parionssport" },
    { id: 60, name: "FDJ", key: "fdj" }
];

// Bookmakers populaires en Afrique de l'Ouest (à afficher en premier)
const POPULAR_BOOKMAKERS_AFRICA = [
    { id: 36, name: "1xBet", key: "1xbet", popular: true, region: "africa" },
    { id: 14, name: "Betway", key: "betway", popular: true, region: "africa" },
    { id: 35, name: "22bet", key: "22bet", popular: true, region: "africa" },
    { id: 38, name: "Melbet", key: "melbet", popular: true, region: "africa" },
    { id: 39, name: "Betwinner", key: "betwinner", popular: true, region: "africa" },
    { id: 44, name: "1win", key: "1win", popular: true, region: "africa" },
    { id: 51, name: "SportyBet", key: "sportybet", popular: true, region: "africa" },
    { id: 52, name: "Bet9ja", key: "bet9ja", popular: true, region: "africa" },
    { id: 50, name: "Betika", key: "betika", popular: true, region: "africa" },
    { id: 54, name: "Premier Bet", key: "premierbet", popular: true, region: "africa" },
    { id: 8, name: "Bet365", key: "bet365", popular: true, region: "global" },
    { id: 4, name: "Pinnacle", key: "pinnacle", popular: true, region: "global" },
    { id: 6, name: "Bwin", key: "bwin", popular: true, region: "europe" },
    { id: 20, name: "Unibet", key: "unibet", popular: true, region: "europe" }
];

// ============== PROMPTS OFFICIELS ==============

const PROMPTS = {
    // PROMPT 1 - Rôle initial
    systemRole: `Tu es un pronostiqueur expert en analyse des statistiques des équipes et donc expert dans la prédiction de certains évènements issus du Football. Pour chaque pronostique, tu t'assures de prendre en compte chaque élément statistique en incluant certains biais notamment les émotions des joueurs qui peuvent modifier le résultat.

Tu dois réfléchir étape par étape, analyser en profondeur toutes les données avant de formuler ta prédiction. Prends le temps de considérer tous les facteurs.`,

    // PROMPT 1 - Contexte + Analyse complète
    matchAnalysis: (teamA, teamB, stats, venue, championship, odds) => `
Mon contexte : Nous sommes en ${championship}. Les 2 équipes qui s'affrontent sont ${teamA} et ${teamB}.

Voici les statistiques complètes:

COMPOSITIONS PROBABLES:
${JSON.stringify(stats.lineups || stats.COMPOS_PROBABLES || {}, null, 2)}

CLASSEMENT:
${JSON.stringify(stats.standings || stats.CLASSEMENT || {}, null, 2)}

STATS ${teamA}:
${JSON.stringify(stats.teamAStats || stats.STATS_EQUIPE_A || {}, null, 2)}

STATS ${teamB}:
${JSON.stringify(stats.teamBStats || stats.STATS_EQUIPE_B || {}, null, 2)}

MATCHS RÉCENTS ${teamA}:
${JSON.stringify(stats.teamARecentMatches || stats.MATCHS_RECENTS_A || [], null, 2)}

MATCHS RÉCENTS ${teamB}:
${JSON.stringify(stats.teamBRecentMatches || stats.MATCHS_RECENTS_B || [], null, 2)}

PRÉCÉDENTES CONFRONTATIONS:
${JSON.stringify(stats.headToHead || stats.CONFRONTATIONS || {}, null, 2)}

COTES DU BOOKMAKER SÉLECTIONNÉ:
${JSON.stringify(odds || {}, null, 2)}

Le match se joue ${venue}.

À partir de ces données [DATAS], effectue les analyses suivantes:

1. ENJEU DU MATCH
Dis moi quel est l'enjeu du match pour chaque équipe ?

2. PRÉDICTION BTTS (Both Teams To Score)
Calcule la probabilité personnelle que ${teamA} et ${teamB} marquent chacun au moins 1 but. Dans le but de prédire si les 2 équipes pourraient marquer ou non au prochain match.

3. PRÉDICTION DU VAINQUEUR
Calcule la probabilité personnelle que ${teamA} gagne le match, ensuite tu fais de même pour ${teamB} et tu détermines qui va potentiellement gagner ou si il y'aura Match Nul en expliquant pourquoi.

4. PRÉDICTION NOMBRE DE BUTS
Calcule le nombre de buts potentiels qu'il pourrait avoir dans ce match en expliquant pourquoi.

5. TENDANCE GLOBALE
Quel est ton avis sur la tendance globale de leur prochaine confrontation ? Quelles sont les scénarios très envisageables ?

6. ANALYSE DES COTES
À partir des cotes fournies, identifie les options qui offrent une bonne value (cote supérieure à la probabilité estimée).

Réponds en JSON avec la structure suivante:
{
    "enjeu": {
        "teamA": { "description": "...", "motivation": "high|medium|low" },
        "teamB": { "description": "...", "motivation": "high|medium|low" }
    },
    "btts": {
        "probability": 0.0,
        "prediction": "oui|non",
        "analysis": "...",
        "factors": ["...", "..."]
    },
    "winner": {
        "teamA": { "probability": 0.0, "analysis": "..." },
        "teamB": { "probability": 0.0, "analysis": "..." },
        "draw": { "probability": 0.0, "analysis": "..." },
        "prediction": "teamA|teamB|draw",
        "confidence": "high|medium|low"
    },
    "totalGoals": {
        "expected": 0.0,
        "over15": 0.0,
        "over25": 0.0,
        "over35": 0.0,
        "under25": 0.0,
        "analysis": "..."
    },
    "trend": {
        "globalAnalysis": "...",
        "scenarios": [
            { "description": "...", "probability": 0.0 }
        ],
        "recommendation": "..."
    },
    "oddsAnalysis": {
        "valueOptions": [
            { "option": "...", "odds": 0.0, "estimatedProb": 0.0, "impliedProb": 0.0, "value": true|false }
        ],
        "bestValue": "...",
        "safestOption": "..."
    }
}`,

    // PROMPT 2 - Analyse des cotes et sélection
    oddsAnalysis: (previousAnalysis, odds) => `
Voici mon analyse précédente du match:
${JSON.stringify(previousAnalysis, null, 2)}

Je vais te donner des options de pari ainsi que les cotes issues d'un bookmaker. Parmi ces options, dis-moi quelles sont celles qui ont le plus de probabilités d'arriver. Prends en compte le fait que nous voulons aussi une cote optimale.

Voici les options de pari:
${JSON.stringify(odds, null, 2)}

Réponds en JSON:
{
    "recommendedOptions": [
        {
            "option": "...",
            "odds": 0.0,
            "estimatedProbability": 0.0,
            "impliedProbability": 0.0,
            "value": 0.0,
            "reasoning": "...",
            "riskLevel": "low|medium|high"
        }
    ],
    "avoidOptions": [
        { "option": "...", "odds": 0.0, "reasoning": "..." }
    ],
    "bestValue": "...",
    "safestOption": "..."
}`,

    // PROMPT 3 - Synthèse des analyses IA
    synthesis: (analysis1, analysis2, selectedOptions) => `
Analyse IA 1 (Claude):
${JSON.stringify(analysis1, null, 2)}

Analyse IA 2 (DeepSeek):
${JSON.stringify(analysis2, null, 2)}

Voici l'analyse d'une autre IA sur ce même match. À partir de ses analyses et la tienne, fais une synthèse et couvre le maximum de scénarios qui vont se produire avec des options qui ont le plus de probabilité d'apparaître en respectant un ratio risque/rendement.

Options sélectionnées par l'utilisateur: ${JSON.stringify(selectedOptions)}

Dis-moi si cela couvre le maximum de scénarios probables avec value ?

Réponds en JSON:
{
    "synthesis": "...",
    "consensusPoints": ["...", "..."],
    "divergencePoints": ["...", "..."],
    "scenarios": [
        { "scenario": "...", "probability": 0.0, "coveredByOptions": true|false }
    ],
    "optionsValidation": {
        "approved": true|false,
        "coverageScore": 0.0,
        "valueScore": 0.0,
        "suggestions": "...",
        "missingCoverage": ["..."]
    },
    "finalRecommendation": "..."
}`,

    // PROMPT 3.2 - Calcul Kelly
    kellyCalculation: (capital, minBet, maxPercentage, options) => `
Mon capital est de: ${capital} FCFA et ${minBet} FCFA est la mise minimale.

Options sélectionnées avec leurs probabilités et cotes:
${JSON.stringify(options, null, 2)}

Fais le calcul (Kelly) des mises pour garantir un bon rendement sachant qu'on ne veut pas dépasser ${maxPercentage}% en terme de mises totales.

Formule Kelly: f* = (bp - q) / b
Où:
- f* = fraction du capital à miser
- b = cote décimale - 1
- p = probabilité estimée de gain
- q = probabilité de perte (1 - p)

Réponds en JSON:
{
    "totalBudget": 0,
    "maxBudgetAllowed": 0,
    "budgetUsagePercentage": 0.0,
    "stakes": [
        {
            "option": "...",
            "odds": 0.0,
            "estimatedProbability": 0.0,
            "kellyPercentage": 0.0,
            "kellyRaw": 0,
            "adjustedStake": 0,
            "potentialReturn": 0,
            "potentialProfit": 0
        }
    ],
    "totalStake": 0,
    "expectedValue": 0,
    "expectedROI": 0.0,
    "riskLevel": "low|medium|high",
    "calculations": "..."
}`,

    // PROMPT 4 - Stratégie de couverture (Hedging)
    hedgingStrategy: (originalBets, liveStats, currentOdds, cashouts, matchTime, score, lineups) => `
Voici la composition officielle du match:
EQUIPE A: ${JSON.stringify(lineups?.teamA || lineups?.equipe_A || {}, null, 2)}
EQUIPE B: ${JSON.stringify(lineups?.teamB || lineups?.equipe_B || {}, null, 2)}

Les stats live du match:
${JSON.stringify(liveStats, null, 2)}

Le score actuel est de: ${score}
Le temps de jeu actuel est de: ${matchTime}

Voici les dernières mises à jour des cotes:
${JSON.stringify(currentOdds, null, 2)}

Voici les mises utilisées et cashout pour chaque option:
${JSON.stringify(originalBets.map(bet => ({
    option: bet.option,
    stake: bet.stake,
    originalOdds: bet.odds,
    currentCashout: cashouts[bet.option] || 0
})), null, 2)}

Prends en compte que la mise minimale chez le bookmaker est de 90 FCFA.

Revois les options qu'on a choisi à partir des nouvelles infos que je t'ai donné (stats live, cotes..) sachant que j'ai déjà parié. Donne moi tes recommandations pour un bon hedging dynamique qui réduirait la perte au maximum sur les scénarios possibles maintenant (Pas de problème de liquidité) si le scénario de base n'est pas en route pour être validé en respectant un bon ratio risque/rendement.

Fais des calculs exacts à partir des (mises et cashout) et n'oublie pas d'enlever les mises pour obtenir les gains. Montre moi des preuves pour éviter un mauvais calcul des mises.

Réponds en JSON:
{
    "currentStatus": {
        "overall": "onTrack|atRisk|losing|winning",
        "analysis": "...",
        "optionsStatus": [
            {
                "option": "...",
                "status": "winning|losing|uncertain",
                "currentValue": 0,
                "profitIfWin": 0,
                "lossIfLose": 0
            }
        ]
    },
    "recommendations": [
        {
            "action": "hold|cashout|hedge|partialCashout",
            "option": "...",
            "reasoning": "...",
            "hedgeDetails": {
                "newBet": "...",
                "newOdds": 0.0,
                "stakeRequired": 0,
                "guaranteedProfit": 0
            }
        }
    ],
    "scenarios": [
        {
            "scenario": "...",
            "probability": 0.0,
            "profitWithoutHedge": 0,
            "profitWithHedge": 0
        }
    ],
    "calculations": {
        "totalInvested": 0,
        "currentCashoutTotal": 0,
        "bestCaseProfit": 0,
        "worstCaseLoss": 0,
        "hedgedBestCase": 0,
        "hedgedWorstCase": 0,
        "breakdownDetails": "..."
    },
    "finalAdvice": "..."
}`,

    // Prompt pour les recommandations de gestion de capital
    capitalRecommendations: (history, currentBalance, stats) => `
Voici l'historique du capital de l'utilisateur:
${JSON.stringify(history, null, 2)}

Solde actuel: ${currentBalance} FCFA

Statistiques:
${JSON.stringify(stats, null, 2)}

Analyse l'historique et donne des recommandations personnalisées pour améliorer la gestion du capital.

Réponds en JSON:
{
    "performance": {
        "roi": 0.0,
        "winRate": 0.0,
        "averageProfit": 0,
        "averageLoss": 0,
        "profitFactor": 0.0,
        "trend": "up|down|stable"
    },
    "strengths": ["...", "..."],
    "weaknesses": ["...", "..."],
    "recommendations": [
        {
            "category": "bankroll|strategy|psychology|timing",
            "advice": "...",
            "priority": "high|medium|low"
        }
    ],
    "nextSteps": ["...", "..."],
    "riskAssessment": {
        "currentRisk": "low|medium|high",
        "recommendedMaxBet": 0,
        "suggestedUnitSize": 0
    }
}`
};

// ============== API CALLS ==============

/**
 * Appel à l'API Claude (Anthropic) avec Extended Thinking
 * Utilise le mode thinking pour une analyse approfondie
 */
async function callClaude(prompt, apiKey, systemPrompt = PROMPTS.systemRole, useThinking = true) {
    console.log("🧠 Calling Claude API with Extended Thinking...");
    
    const requestBody = {
        model: "claude-sonnet-4-20250514",
        max_tokens: 16000,
        messages: [
            { role: "user", content: prompt }
        ],
        system: systemPrompt
    };

    // Activer le mode thinking pour une réflexion approfondie
    if (useThinking) {
        requestBody.thinking = {
            type: "enabled",
            budget_tokens: 10000  // Budget pour la réflexion interne
        };
    }

    try {
        const response = await fetch(ANTHROPIC_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01"  // Version stable
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            
            // Si le thinking n'est pas supporté, réessayer sans
            if (response.status === 400 && useThinking && errorText.includes('thinking')) {
                console.log("⚠️ Extended thinking not supported, retrying without...");
                return callClaude(prompt, apiKey, systemPrompt, false);
            }
            
            throw new Error(`Claude API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        
        // Extraire le contenu et le thinking
        let content = "";
        let thinking = "";
        
        if (data.content) {
            for (const block of data.content) {
                if (block.type === "thinking") {
                    thinking = block.thinking;
                    console.log("💭 Claude thinking process captured");
                } else if (block.type === "text") {
                    content = block.text;
                }
            }
        }

        // Parser le JSON de la réponse
        try {
            // Nettoyer la réponse si elle contient des backticks
            const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const parsed = JSON.parse(cleanContent);
            
            // Ajouter le thinking au résultat
            if (thinking) {
                parsed._thinking = thinking;
            }
            
            return parsed;
        } catch {
            return { 
                rawResponse: content,
                _thinking: thinking 
            };
        }

    } catch (error) {
        console.error("❌ Claude API Error:", error.message);
        throw error;
    }
}

/**
 * Appel à l'API DeepSeek avec mode Reasoner (Thinking)
 * Utilise deepseek-reasoner pour une analyse avec raisonnement
 */
async function callDeepSeek(prompt, apiKey, systemPrompt = PROMPTS.systemRole, useReasoner = true) {
    console.log("🔮 Calling DeepSeek API with Reasoning...");
    
    // Utiliser le modèle reasoner pour le thinking
    const model = useReasoner ? "deepseek-reasoner" : "deepseek-chat";
    
    const requestBody = {
        model: model,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
        ],
        temperature: useReasoner ? 0 : 0.7, // Reasoner n'utilise pas de temperature
        max_tokens: 8000
    };

    try {
        const response = await fetch(DEEPSEEK_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const error = await response.text();
            
            // Si le modèle reasoner n'est pas disponible, fallback sur chat
            if (response.status === 400 && useReasoner) {
                console.log("⚠️ DeepSeek Reasoner not available, falling back to chat model...");
                return callDeepSeek(prompt, apiKey, systemPrompt, false);
            }
            
            throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
        }

        const data = await response.json();
        const message = data.choices[0].message;
        
        // Extraire le reasoning_content si disponible (mode reasoner)
        let thinking = null;
        let content = message.content;
        
        if (message.reasoning_content) {
            thinking = message.reasoning_content;
            console.log("💭 DeepSeek reasoning process captured");
        }

        // Parser le JSON
        try {
            const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const parsed = JSON.parse(cleanContent);
            
            if (thinking) {
                parsed._thinking = thinking;
            }
            
            return parsed;
        } catch {
            return { 
                rawResponse: content,
                _thinking: thinking 
            };
        }

    } catch (error) {
        console.error("❌ DeepSeek API Error:", error.message);
        throw error;
    }
}

// ============== SERVICE DE PRÉDICTION ==============

class PredictionService {
    constructor(claudeKey, deepseekKey) {
        this.claudeKey = claudeKey;
        this.deepseekKey = deepseekKey;
    }

    /**
     * ÉTAPE 1: Analyse du match par les deux IA
     * Utilise les cotes du bookmaker sélectionné
     */
    async analyzeMatch(teamA, teamB, stats, venue, championship, odds) {
        const prompt = PROMPTS.matchAnalysis(teamA, teamB, stats, venue, championship, odds);
        
        console.log("📊 Step 1: Match Analysis with both AIs...");
        console.log("   Using selected bookmaker odds for analysis");
        
        // Appels parallèles aux deux IA avec thinking
        const [claudeAnalysis, deepseekAnalysis] = await Promise.all([
            this.claudeKey ? callClaude(prompt, this.claudeKey, PROMPTS.systemRole, true) : null,
            this.deepseekKey ? callDeepSeek(prompt, this.deepseekKey, PROMPTS.systemRole, true) : null
        ]);

        return {
            claude: claudeAnalysis,
            deepseek: deepseekAnalysis,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * ÉTAPE 2: Analyse des cotes
     */
    async analyzeOdds(previousAnalysis, odds) {
        const prompt = PROMPTS.oddsAnalysis(previousAnalysis, odds);
        console.log("💰 Step 2: Odds Analysis...");
        
        // Utiliser Claude pour l'analyse des cotes (avec thinking)
        return await callClaude(prompt, this.claudeKey, PROMPTS.systemRole, true);
    }

    /**
     * ÉTAPE 3: Synthèse des analyses
     */
    async synthesizeAnalyses(claudeAnalysis, deepseekAnalysis, selectedOptions) {
        const prompt = PROMPTS.synthesis(claudeAnalysis, deepseekAnalysis, selectedOptions);
        console.log("🔄 Step 3: Synthesis...");
        
        // Utiliser DeepSeek pour la synthèse (validation croisée)
        return await callDeepSeek(prompt, this.deepseekKey, PROMPTS.systemRole, true);
    }

    /**
     * ÉTAPE 3.2: Calcul des mises optimales (Kelly)
     */
    async calculateStakes(capital, minBet, maxPercentage, options) {
        const prompt = PROMPTS.kellyCalculation(capital, minBet, maxPercentage, options);
        console.log("🧮 Step 3.2: Kelly Calculation...");
        
        // Utiliser DeepSeek Reasoner pour les calculs
        return await callDeepSeek(prompt, this.deepseekKey, PROMPTS.systemRole, true);
    }

    /**
     * ÉTAPE 4: Stratégie de couverture en live
     * Utilise Claude avec thinking pour l'analyse en temps réel
     */
    async getHedgingStrategy(params) {
        const { originalBets, liveStats, currentOdds, cashouts, matchTime, score, lineups } = params;
        
        const prompt = PROMPTS.hedgingStrategy(
            originalBets, liveStats, currentOdds, cashouts, matchTime, score, lineups
        );
        
        console.log("🛡️ Step 4: Hedging Strategy with Claude Thinking...");
        
        // Claude avec extended thinking pour la stratégie de couverture
        return await callClaude(prompt, this.claudeKey, PROMPTS.systemRole, true);
    }

    /**
     * Recommandations de gestion de capital
     */
    async getCapitalRecommendations(history, currentBalance, stats) {
        const prompt = PROMPTS.capitalRecommendations(history, currentBalance, stats);
        console.log("📈 Capital Recommendations...");
        
        return await callClaude(prompt, this.claudeKey, PROMPTS.systemRole, true);
    }

    /**
     * Pipeline complet de prédiction
     * @param {Object} matchData - Données du match
     * @param {number} userCapital - Capital de l'utilisateur
     * @param {string} bookmakerKey - Clé du bookmaker sélectionné
     * @param {number} minBet - Mise minimale (default: 90 FCFA)
     * @param {number} maxPercentage - % max du capital à miser (default: 6%)
     */
    async runFullPrediction(matchData, userCapital, bookmakerKey, minBet = 90, maxPercentage = 6) {
        console.log("\n🚀 Starting full prediction pipeline with AI Thinking...");
        console.log(`Match: ${matchData.homeTeam} vs ${matchData.awayTeam}`);
        console.log(`Capital: ${userCapital} FCFA | Bookmaker: ${bookmakerKey}`);
        console.log(`AI Engines: Claude (Extended Thinking) + DeepSeek (Reasoner)\n`);

        try {
            // Récupérer les cotes du bookmaker sélectionné
            const selectedOdds = this.extractBookmakerOdds(matchData, bookmakerKey);
            console.log(`📊 Using odds from: ${bookmakerKey}`);
            console.log(`   Found ${Object.keys(selectedOdds).length} betting options\n`);

            // ÉTAPE 1: Analyse du match par les deux IA (avec les cotes sélectionnées)
            console.log("━".repeat(50));
            console.log("📊 ÉTAPE 1: Analyse du match avec IA Thinking...");
            console.log("━".repeat(50));
            
            const matchAnalysis = await this.analyzeMatch(
                matchData.homeTeam,
                matchData.awayTeam,
                matchData.stats || matchData._raw || matchData,
                matchData.venue || `au stade ${matchData.TERRAIN_DE_JEU?.stade || 'non spécifié'}`,
                matchData.league,
                selectedOdds
            );

            // Afficher un résumé du thinking
            if (matchAnalysis.claude?._thinking) {
                console.log("\n💭 Claude a réfléchi en profondeur sur l'analyse...");
            }
            if (matchAnalysis.deepseek?._thinking) {
                console.log("💭 DeepSeek a appliqué son raisonnement...");
            }

            // ÉTAPE 2: Analyse des cotes
            console.log("\n" + "━".repeat(50));
            console.log("💰 ÉTAPE 2: Analyse des cotes...");
            console.log("━".repeat(50));
            
            const oddsAnalysis = await this.analyzeOdds(
                matchAnalysis.claude || matchAnalysis.deepseek,
                selectedOdds
            );

            // ÉTAPE 3: Synthèse des deux analyses
            console.log("\n" + "━".repeat(50));
            console.log("🔄 ÉTAPE 3: Synthèse des analyses...");
            console.log("━".repeat(50));
            
            const recommendedOptions = oddsAnalysis.recommendedOptions || [];
            const synthesis = await this.synthesizeAnalyses(
                matchAnalysis.claude,
                matchAnalysis.deepseek,
                recommendedOptions
            );

            // ÉTAPE 3.2: Calcul des mises Kelly
            console.log("\n" + "━".repeat(50));
            console.log("🧮 ÉTAPE 3.2: Calcul des mises (Kelly)...");
            console.log("━".repeat(50));
            
            const stakes = await this.calculateStakes(
                userCapital,
                minBet,
                maxPercentage,
                recommendedOptions.map(opt => ({
                    option: opt.option,
                    odds: opt.odds,
                    probability: opt.estimatedProbability || opt.probability || 0.5
                }))
            );

            console.log("\n✅ Pipeline completed successfully!");
            console.log("━".repeat(50));

            return {
                matchAnalysis,
                oddsAnalysis,
                synthesis,
                stakes,
                selectedBookmaker: {
                    key: bookmakerKey,
                    odds: selectedOdds,
                    optionsCount: Object.keys(selectedOdds).length
                },
                meta: {
                    matchId: matchData.id,
                    homeTeam: matchData.homeTeam,
                    awayTeam: matchData.awayTeam,
                    league: matchData.league,
                    userCapital,
                    bookmaker: bookmakerKey,
                    aiEngines: {
                        primary: "Claude (claude-sonnet-4-20250514) with Extended Thinking",
                        secondary: "DeepSeek (deepseek-reasoner) with Reasoning"
                    },
                    generatedAt: new Date().toISOString()
                }
            };

        } catch (error) {
            console.error("❌ Pipeline error:", error);
            throw error;
        }
    }

    /**
     * Extrait les cotes du bookmaker sélectionné depuis les données du match
     */
    extractBookmakerOdds(matchData, bookmakerKey) {
        // Structure des cotes dans les documents Firebase
        const allOdds = matchData.odds || matchData.COTES || {};
        
        // Chercher le bookmaker par sa clé
        if (allOdds[bookmakerKey]) {
            return allOdds[bookmakerKey];
        }
        
        // Chercher par nom (case insensitive)
        const lowerKey = bookmakerKey.toLowerCase();
        for (const [key, value] of Object.entries(allOdds)) {
            if (key.toLowerCase() === lowerKey || key.toLowerCase().includes(lowerKey)) {
                return value;
            }
        }
        
        // Fallback: utiliser les cotes par défaut ou les premières disponibles
        if (allOdds.default) {
            console.log(`⚠️ Bookmaker "${bookmakerKey}" not found, using default odds`);
            return allOdds.default;
        }
        
        // Utiliser le premier bookmaker disponible
        const firstKey = Object.keys(allOdds)[0];
        if (firstKey) {
            console.log(`⚠️ Bookmaker "${bookmakerKey}" not found, using "${firstKey}" odds`);
            return allOdds[firstKey];
        }
        
        console.log(`⚠️ No odds available for any bookmaker`);
        return {};
    }

    /**
     * Récupère la liste des bookmakers disponibles pour un match
     */
    getAvailableBookmakers(matchData) {
        const allOdds = matchData.odds || matchData.COTES || {};
        const available = [];
        
        for (const [key, value] of Object.entries(allOdds)) {
            if (value && typeof value === 'object' && Object.keys(value).length > 0) {
                // Trouver le bookmaker dans notre liste
                const bookmaker = POPULAR_BOOKMAKERS_AFRICA.find(b => 
                    b.key.toLowerCase() === key.toLowerCase() ||
                    b.name.toLowerCase() === key.toLowerCase()
                ) || API_FOOTBALL_BOOKMAKERS.find(b =>
                    b.key.toLowerCase() === key.toLowerCase() ||
                    b.name.toLowerCase() === key.toLowerCase()
                );
                
                available.push({
                    key: key,
                    name: bookmaker?.name || key,
                    id: bookmaker?.id || null,
                    optionsCount: Object.keys(value).length,
                    popular: bookmaker?.popular || false
                });
            }
        }
        
        // Trier: populaires d'abord, puis par nombre d'options
        return available.sort((a, b) => {
            if (a.popular && !b.popular) return -1;
            if (!a.popular && b.popular) return 1;
            return b.optionsCount - a.optionsCount;
        });
    }

    /**
     * Génère des recommandations personnalisées basées sur l'historique de l'utilisateur
     * Utilise DeepSeek Reasoner pour une analyse approfondie
     */
    async generateUserRecommendations(userStats) {
        console.log("\n📊 Generating personalized recommendations with DeepSeek Reasoner...");
        
        const prompt = `
Tu es un conseiller expert en paris sportifs. Analyse les données suivantes de l'utilisateur et génère des recommandations personnalisées pour améliorer ses performances.

DONNÉES DE L'UTILISATEUR:

📊 CAPITAL:
- Solde actuel: ${userStats.user?.currentBalance || 0} FCFA
- Gains totaux: ${userStats.capital?.totalGains || 0} FCFA
- Pertes totales: ${userStats.capital?.totalLosses || 0} FCFA
- Mise moyenne: ${Math.round(userStats.capital?.averageBet || 0)} FCFA

📈 STATISTIQUES DE PARIS:
- Total de prédictions: ${userStats.predictions?.total || 0}
- Gagnées: ${userStats.predictions?.won || 0}
- Perdues: ${userStats.predictions?.lost || 0}
- Taux de réussite global: ${(userStats.predictions?.winRate || 0).toFixed(1)}%
- Taux de réussite récent (20 derniers): ${(userStats.predictions?.recentWinRate || 0).toFixed(1)}%

📋 PERFORMANCE PAR TYPE D'OPTION:
${JSON.stringify(userStats.optionStats || {}, null, 2)}

💰 HISTORIQUE CAPITAL (30 derniers mouvements):
${JSON.stringify((userStats.capital?.history || []).slice(0, 10).map(h => ({
    change: h.change,
    reason: h.reason,
    balance: h.newBalance
})), null, 2)}

Analyse ces données en profondeur et génère des recommandations dans le format JSON suivant:

{
    "analysis": {
        "strengths": ["...", "..."],
        "weaknesses": ["...", "..."],
        "patterns": ["...", "..."],
        "riskProfile": "conservative|moderate|aggressive",
        "trend": "improving|stable|declining"
    },
    "recommendations": [
        {
            "category": "bankroll|strategy|option_types|timing|psychology",
            "priority": "high|medium|low",
            "title": "...",
            "description": "...",
            "actionable": "..."
        }
    ],
    "optimalSettings": {
        "suggestedMaxBetPercentage": 0.0,
        "suggestedMinBet": 0,
        "preferredOptionTypes": ["..."],
        "avoidOptionTypes": ["..."]
    },
    "nextSteps": [
        {
            "step": "...",
            "reason": "..."
        }
    ],
    "motivationalMessage": "..."
}`;

        try {
            const result = await callDeepSeek(prompt, this.deepseekKey, 
                "Tu es un conseiller expert en paris sportifs avec une approche analytique et bienveillante. Tu analyses les données de manière objective et donnes des conseils personnalisés et actionnables.", 
                true);
            
            console.log("✅ Recommendations generated successfully!");
            return {
                success: true,
                recommendations: result,
                generatedAt: new Date().toISOString()
            };
        } catch (error) {
            console.error("❌ Error generating recommendations:", error.message);
            return {
                success: false,
                error: error.message,
                fallbackRecommendations: this.generateFallbackRecommendations(userStats)
            };
        }
    }

    /**
     * Génère des recommandations de secours si l'API échoue
     */
    generateFallbackRecommendations(userStats) {
        const winRate = userStats.predictions?.winRate || 0;
        const recentWinRate = userStats.predictions?.recentWinRate || 0;
        const balance = userStats.user?.currentBalance || 0;

        const recommendations = [];

        // Recommandations basées sur le taux de réussite
        if (winRate < 40) {
            recommendations.push({
                category: 'strategy',
                priority: 'high',
                title: 'Améliorer la sélection des paris',
                description: 'Votre taux de réussite est en dessous de 40%. Concentrez-vous sur des paris plus sûrs.',
                actionable: 'Privilégiez les Double Chance et les Over 1.5 buts'
            });
        }

        // Recommandations basées sur la tendance
        if (recentWinRate < winRate - 10) {
            recommendations.push({
                category: 'psychology',
                priority: 'high',
                title: 'Série difficile détectée',
                description: 'Vos performances récentes sont en baisse. Prenez du recul.',
                actionable: 'Réduisez vos mises de 50% pendant les 5 prochains paris'
            });
        }

        // Recommandations de bankroll
        if (balance < 10000) {
            recommendations.push({
                category: 'bankroll',
                priority: 'high',
                title: 'Capital faible',
                description: 'Votre capital est limité. Protégez-le.',
                actionable: 'Ne dépassez pas 3% de mise par pari'
            });
        }

        return {
            analysis: {
                strengths: ['Utilisation de l\'IA pour les analyses'],
                weaknesses: winRate < 50 ? ['Taux de réussite à améliorer'] : [],
                riskProfile: balance < 20000 ? 'conservative' : 'moderate',
                trend: recentWinRate > winRate ? 'improving' : recentWinRate < winRate ? 'declining' : 'stable'
            },
            recommendations,
            optimalSettings: {
                suggestedMaxBetPercentage: balance < 20000 ? 3 : 5,
                suggestedMinBet: 100,
                preferredOptionTypes: ['DOUBLE_CHANCE', 'TOTALS'],
                avoidOptionTypes: ['CORRECT_SCORE']
            },
            nextSteps: [
                { step: 'Analyser vos 5 derniers paris perdus', reason: 'Identifier les erreurs récurrentes' },
                { step: 'Fixer un objectif de gain hebdomadaire', reason: 'Mieux gérer vos attentes' }
            ],
            motivationalMessage: 'Chaque expert a commencé comme débutant. Continuez à apprendre !'
        };
    }
}

// ============== EXPORTS ==============

module.exports = { 
    PredictionService, 
    PROMPTS, 
    callClaude, 
    callDeepSeek,
    API_FOOTBALL_BOOKMAKERS,
    POPULAR_BOOKMAKERS_AFRICA
};
