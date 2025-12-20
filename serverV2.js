/**
 * E-Cauri App - Backend API Server V2
 * 
 * Architecture:
 * - Matchs/Opportunities → Firebase Firestore (collection: opportunities)
 * - Données utilisateur → Firebase Firestore
 * - Authentification → Firebase Auth
 * - Stats Live + Cotes → API-Football (PRO)
 * - Prédictions IA → Claude (Extended Thinking) + DeepSeek (Reasoner)
 * 
 * Projet Firebase: football-opportunities
 */

// Charger les variables d'environnement
require('dotenv').config();

const express = require('express');
const cors = require('cors');

// Services
const { initializeFirebase, FirestoreService, admin } = require('./config/firebaseService');
const { 
    PredictionService, 
    API_FOOTBALL_BOOKMAKERS, 
    POPULAR_BOOKMAKERS_AFRICA 
} = require('./functions/predictionServiceV3');
const { LiveFootballService } = require('./functions/liveFootballService');

// ============== CONFIGURATION ==============

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - Configuration CORS pour production
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5500', 'https://e-cauri-app2.vercel.app'];

app.use(cors({
    origin: function(origin, callback) {
        // Autoriser les requêtes sans origin (comme les apps mobiles ou Postman)
        if (!origin) return callback(null, true);
        
        // Autoriser tous les domaines Vercel et les domaines configurés
        if (allowedOrigins.includes(origin) || 
            origin.endsWith('.vercel.app') || 
            origin.includes('localhost')) {
            return callback(null, true);
        }
        
        // En développement, autoriser tout
        if (process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }
        
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// ============== INITIALISATION DES SERVICES ==============

let firestoreService = null;
let predictionService = null;
let liveFootballService = null;
let isFirebaseInitialized = false;

// Initialiser Firebase
try {
    // Supporter plusieurs formats de configuration Firebase
    let serviceAccountConfig = process.env.FIREBASE_SERVICE_ACCOUNT 
        || process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 
        || process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    
    // Si c'est explicitement en Base64
    if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 && !process.env.FIREBASE_SERVICE_ACCOUNT) {
        console.log("📦 Decoding Firebase credentials from Base64...");
        try {
            serviceAccountConfig = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
        } catch (decodeError) {
            console.error("❌ Failed to decode Base64:", decodeError.message);
        }
    }
    
    if (serviceAccountConfig) {
        initializeFirebase(serviceAccountConfig);
        firestoreService = new FirestoreService();
        isFirebaseInitialized = true;
        console.log("✅ Firebase initialized - Project: football-opportunities");
    } else {
        console.warn("⚠️ FIREBASE_SERVICE_ACCOUNT not set - running in MOCK mode");
        console.warn("   Pour connecter Firebase, ajoutez dans .env :");
        console.warn('   FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}');
        console.warn('   ou FIREBASE_SERVICE_ACCOUNT_BASE64=<base64_encoded_json>');
    }
} catch (error) {
    console.error("❌ Firebase initialization failed:", error.message);
    console.error("   Vérifiez votre configuration dans .env");
    console.error("   Conseil: Essayez d'encoder votre serviceAccountKey.json en Base64");
}

// Initialiser le service de prédiction IA (Claude + DeepSeek avec Thinking)
if (process.env.ANTHROPIC_API_KEY || process.env.DEEPSEEK_API_KEY) {
    predictionService = new PredictionService(
        process.env.ANTHROPIC_API_KEY,
        process.env.DEEPSEEK_API_KEY
    );
    console.log("✅ Prediction service initialized");
    console.log("   🧠 Claude API: " + (process.env.ANTHROPIC_API_KEY ? "Ready (Extended Thinking)" : "Not configured"));
    console.log("   🔮 DeepSeek API: " + (process.env.DEEPSEEK_API_KEY ? "Ready (Reasoner)" : "Not configured"));
} else {
    console.warn("⚠️ AI API keys not set - predictions will use mock data");
    console.warn("   Set ANTHROPIC_API_KEY and/or DEEPSEEK_API_KEY in .env");
}

// Initialiser le service API-Football pour le live
if (process.env.API_FOOTBALL_KEY) {
    liveFootballService = new LiveFootballService(process.env.API_FOOTBALL_KEY);
    console.log("✅ Live Football service initialized (API-Football PRO)");
} else {
    console.warn("⚠️ API_FOOTBALL_KEY not set - live features disabled");
}

// ============== MIDDLEWARE AUTH ==============

const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: "Unauthorized - No token provided", code: "NO_TOKEN" });
    }

    const token = authHeader.split('Bearer ')[1];

    try {
        if (isFirebaseInitialized) {
            const decodedToken = await admin.auth().verifyIdToken(token);
            req.user = {
                uid: decodedToken.uid,
                email: decodedToken.email,
                displayName: decodedToken.name || decodedToken.email?.split('@')[0]
            };
        } else {
            // Mode mock
            req.user = {
                uid: "mock_user_" + token.substring(0, 8),
                email: "mock@test.com",
                displayName: "Mock User"
            };
        }
        next();
    } catch (error) {
        console.error("Auth error:", error.message);
        
        // Distinguer les types d'erreur pour le frontend
        if (error.code === 'auth/id-token-expired') {
            return res.status(401).json({ 
                error: "Token expired - Please refresh", 
                code: "TOKEN_EXPIRED" 
            });
        } else if (error.code === 'auth/argument-error' || error.code === 'auth/invalid-id-token') {
            return res.status(401).json({ 
                error: "Invalid token format", 
                code: "INVALID_TOKEN" 
            });
        } else {
            return res.status(401).json({ 
                error: "Unauthorized - " + error.message, 
                code: "AUTH_ERROR" 
            });
        }
    }
};

// Middleware optionnel (vérifie l'auth si présent, sinon continue)
const optionalAuthMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const token = authHeader.split('Bearer ')[1];
            if (isFirebaseInitialized) {
                const decodedToken = await admin.auth().verifyIdToken(token);
                req.user = {
                    uid: decodedToken.uid,
                    email: decodedToken.email,
                    displayName: decodedToken.name
                };
            }
        } catch (error) {
            // Token invalide mais on continue quand même
            console.warn("Optional auth failed:", error.message);
        }
    }
    next();
};

// ============== HELPER FUNCTIONS ==============

/**
 * Envoie une notification à l'utilisateur
 * Stocke la notification dans Firebase et peut être récupérée par le frontend via polling ou SSE
 */
async function sendNotificationToUser(userId, notification) {
    try {
        if (!firestoreService) return false;

        // Sauvegarder la notification dans Firebase
        await firestoreService.db.collection('notifications').add({
            userId,
            ...notification,
            read: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`📬 Notification saved for user ${userId}: ${notification.title}`);
        return true;

    } catch (error) {
        console.error("Error sending notification:", error);
        return false;
    }
}

/**
 * Appel à l'API DeepSeek avec mode Reasoner (Thinking)
 * Utilise deepseek-reasoner pour une analyse avec raisonnement profond
 */
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";

async function callDeepSeek(prompt, apiKey, systemPrompt = "", useReasoner = true) {
    console.log("🔮 Calling DeepSeek API with Reasoning...");
    
    if (!apiKey) {
        throw new Error("DeepSeek API key not provided");
    }
    
    // Utiliser le modèle reasoner pour le thinking
    const model = useReasoner ? "deepseek-reasoner" : "deepseek-chat";
    
    const requestBody = {
        model: model,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
        ],
        temperature: useReasoner ? 0 : 0.7,
        max_tokens: 8000
    };

    try {
        const fetch = (await import('node-fetch')).default;
        
        const response = await fetch(DEEPSEEK_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            
            // Si le reasoner n'est pas supporté, réessayer avec chat
            if (response.status === 400 && useReasoner) {
                console.log("⚠️ DeepSeek Reasoner not available, retrying with chat model...");
                return callDeepSeek(prompt, apiKey, systemPrompt, false);
            }
            
            throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        
        // Extraire le contenu et le reasoning
        let content = "";
        let reasoning = "";
        
        if (data.choices && data.choices[0]) {
            const message = data.choices[0].message;
            content = message.content || "";
            
            // Si le modèle reasoner a fourni un reasoning_content
            if (message.reasoning_content) {
                reasoning = message.reasoning_content;
                console.log("💭 DeepSeek reasoning process captured");
            }
        }

        // Parser le JSON de la réponse
        try {
            // Nettoyer la réponse si elle contient des backticks
            const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const parsed = JSON.parse(cleanContent);
            
            // Ajouter le reasoning au résultat
            if (reasoning) {
                parsed._reasoning = reasoning;
            }
            
            return parsed;
        } catch {
            // Si le parsing échoue, retourner le contenu brut
            return { 
                rawResponse: content,
                _reasoning: reasoning 
            };
        }

    } catch (error) {
        console.error("❌ DeepSeek API Error:", error.message);
        throw error;
    }
}

// ============== ROUTES - OPPORTUNITIES (MATCHS) ==============

/**
 * GET /api/opportunities
 * Récupère les matchs/opportunités depuis Firebase
 */
app.get('/api/opportunities', async (req, res) => {
    try {
        if (firestoreService) {
            const opportunities = await firestoreService.getUpcomingOpportunities();
            res.json({ opportunities });
        } else {
            // Mock data
            res.json({
                opportunities: [
                    {
                        id: "opp_1",
                        homeTeam: "PSG",
                        awayTeam: "Marseille",
                        homeTeamId: 85,
                        awayTeamId: 81,
                        fixtureId: 123456,
                        league: "Ligue 1",
                        matchDate: new Date(Date.now() + 86400000).toISOString(),
                        status: "upcoming",
                        stats: mockMatchData.stats,
                        odds: mockMatchData.odds
                    },
                    {
                        id: "opp_2",
                        homeTeam: "Real Madrid",
                        awayTeam: "Barcelona",
                        homeTeamId: 541,
                        awayTeamId: 529,
                        fixtureId: 234567,
                        league: "La Liga",
                        matchDate: new Date(Date.now() + 172800000).toISOString(),
                        status: "upcoming"
                    }
                ]
            });
        }
    } catch (error) {
        console.error("Error fetching opportunities:", error);
        res.status(500).json({ error: "Failed to fetch opportunities" });
    }
});

/**
 * GET /api/opportunities/:id
 * Récupère une opportunité spécifique avec toutes ses données
 */
app.get('/api/opportunities/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (firestoreService) {
            const opportunity = await firestoreService.getOpportunityById(id);
            if (!opportunity) {
                return res.status(404).json({ error: "Opportunity not found" });
            }
            res.json({ opportunity });
        } else {
            // Mock
            res.json({
                opportunity: {
                    id,
                    ...mockMatchData,
                    fixtureId: 123456
                }
            });
        }
    } catch (error) {
        console.error("Error fetching opportunity:", error);
        res.status(500).json({ error: "Failed to fetch opportunity" });
    }
});

/**
 * GET /api/opportunities/live
 * Récupère les matchs en cours
 */
app.get('/api/opportunities/status/live', async (req, res) => {
    try {
        if (firestoreService) {
            const liveOpportunities = await firestoreService.getLiveOpportunities();
            res.json({ opportunities: liveOpportunities });
        } else {
            res.json({ opportunities: [] });
        }
    } catch (error) {
        console.error("Error fetching live opportunities:", error);
        res.status(500).json({ error: "Failed to fetch live opportunities" });
    }
});

// ============== ROUTES - PREDICTIONS ==============

/**
 * GET /api/bookmakers
 * Récupère la liste complète des bookmakers supportés
 */
app.get('/api/bookmakers', (req, res) => {
    res.json({
        popular: POPULAR_BOOKMAKERS_AFRICA,
        all: API_FOOTBALL_BOOKMAKERS,
        total: API_FOOTBALL_BOOKMAKERS.length
    });
});

/**
 * GET /api/opportunities/:id/bookmakers
 * Récupère les bookmakers disponibles pour une opportunité spécifique
 * (avec les cotes déjà présentes dans la base)
 */
app.get('/api/opportunities/:id/bookmakers', async (req, res) => {
    try {
        const { id } = req.params;

        if (firestoreService) {
            const opportunity = await firestoreService.getOpportunityById(id);
            if (!opportunity) {
                return res.status(404).json({ error: "Opportunity not found" });
            }

            // Extraire les bookmakers disponibles depuis les cotes
            const available = predictionService 
                ? predictionService.getAvailableBookmakers(opportunity)
                : extractAvailableBookmakers(opportunity);

            res.json({
                available,
                popular: POPULAR_BOOKMAKERS_AFRICA,
                matchId: id
            });
        } else {
            // Mock - retourner les bookmakers populaires
            res.json({
                available: [
                    { key: "1xbet", name: "1xBet", optionsCount: 25, popular: true },
                    { key: "betway", name: "Betway", optionsCount: 20, popular: true },
                    { key: "bet365", name: "Bet365", optionsCount: 30, popular: true }
                ],
                popular: POPULAR_BOOKMAKERS_AFRICA,
                matchId: id
            });
        }
    } catch (error) {
        console.error("Error fetching bookmakers:", error);
        res.status(500).json({ error: "Failed to fetch bookmakers" });
    }
});

/**
 * Helper: Extrait les bookmakers disponibles depuis les cotes d'un match
 */
function extractAvailableBookmakers(matchData) {
    const allOdds = matchData.odds || matchData.COTES || {};
    const available = [];
    
    for (const [key, value] of Object.entries(allOdds)) {
        if (value && typeof value === 'object' && Object.keys(value).length > 0) {
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
    
    return available.sort((a, b) => {
        if (a.popular && !b.popular) return -1;
        if (!a.popular && b.popular) return 1;
        return b.optionsCount - a.optionsCount;
    });
}

/**
 * POST /api/predictions/analyze
 * Lance l'analyse IA d'une opportunité avec Claude (Thinking) + DeepSeek (Reasoner)
 */
app.post('/api/predictions/analyze', authMiddleware, async (req, res) => {
    try {
        const { opportunityId, userBalance, bookmaker } = req.body;

        if (!opportunityId || !userBalance) {
            return res.status(400).json({ error: "opportunityId and userBalance are required" });
        }

        console.log(`\n🎯 Starting AI Analysis...`);
        console.log(`   Match ID: ${opportunityId}`);
        console.log(`   Capital: ${userBalance} FCFA`);
        console.log(`   Bookmaker: ${bookmaker || 'default'}`);

        // Log de l'action (avec try-catch pour éviter les erreurs)
        try {
            if (firestoreService) {
                await firestoreService.logUserAction(req.user.uid, 'start_analysis', {
                    opportunityId,
                    userBalance,
                    bookmaker
                }, { opportunityId });
            }
        } catch (logError) {
            console.warn("⚠️ Could not log action:", logError.message);
        }

        // Récupérer les données de l'opportunité depuis Firebase
        let matchData;
        try {
            if (firestoreService) {
                matchData = await firestoreService.getOpportunityById(opportunityId);
                if (!matchData) {
                    console.warn("⚠️ Opportunity not found in Firebase, using mock data");
                    matchData = { ...getMockMatchData(), id: opportunityId };
                }
            } else {
                console.log("📦 Using mock match data (Firebase not configured)");
                matchData = { ...getMockMatchData(), id: opportunityId };
            }
        } catch (fetchError) {
            console.error("❌ Error fetching opportunity:", fetchError.message);
            matchData = { ...getMockMatchData(), id: opportunityId };
        }

        // Lancer le pipeline de prédiction IA (Claude + DeepSeek avec Thinking)
        let prediction;
        try {
            if (predictionService) {
                console.log(`\n🧠 Using AI Engines:`);
                console.log(`   - Claude (claude-sonnet-4-20250514) with Extended Thinking`);
                console.log(`   - DeepSeek (deepseek-reasoner) with Reasoning`);
                
                prediction = await predictionService.runFullPrediction(
                    matchData,
                    userBalance,
                    bookmaker || 'default'
                );
            } else {
                // Mock prediction car IA non configurée
                console.log(`⚠️ Using mock prediction (AI not configured)`);
                prediction = generateMockPrediction(matchData, userBalance, bookmaker);
            }
        } catch (aiError) {
            // Si l'IA échoue, utiliser le mock
            console.error("❌ AI prediction failed:", aiError.message);
            console.log("📦 Falling back to mock prediction");
            prediction = generateMockPrediction(matchData, userBalance, bookmaker);
            prediction.aiError = aiError.message;
            prediction.isDemo = true;
        }

        // ========== CALCUL DES STAKES SI VIDES ==========
        // Si l'IA n'a pas généré de stakes, les calculer à partir des options recommandées
        if (!prediction.stakes?.stakes?.length && prediction.oddsAnalysis?.recommendedOptions?.length) {
            console.log(`📊 Calculating stakes from recommended options...`);
            
            const options = prediction.oddsAnalysis.recommendedOptions;
            const maxBudget = Math.round(userBalance * 0.06); // 6% du capital
            
            // Calculer les stakes basées sur Kelly simplifié + EDGE
            const calculatedStakes = options.slice(0, 3).map((opt, index) => {
                const prob = opt.estimatedProbability || opt.probability || 0.5;
                const odds = opt.odds || 1.5;
                
                // ========== CALCUL DE L'EDGE ==========
                // EDGE = (Probabilité × Cote) - 1
                const edge = (prob * odds) - 1;
                const edgePercent = Math.round(edge * 1000) / 10;
                
                // Déterminer le niveau de risque basé sur l'EDGE
                let riskLevel, dangerLevel;
                if (edgePercent >= 6) {
                    riskLevel = 'low';
                    dangerLevel = 'excellent';
                } else if (edgePercent >= 3) {
                    riskLevel = 'low';
                    dangerLevel = 'good';
                } else if (edgePercent >= 0) {
                    riskLevel = 'medium';
                    dangerLevel = 'moderate';
                } else if (edgePercent >= -6) {
                    riskLevel = 'high';
                    dangerLevel = 'no_value';
                } else {
                    riskLevel = 'very_high';
                    dangerLevel = 'dangerous';
                }
                
                // Kelly simplifié: f = (p * b - q) / b où p=prob, b=odds-1, q=1-p
                const b = odds - 1;
                const q = 1 - prob;
                let kellyFraction = Math.max(0, (prob * b - q) / b);
                
                // Limiter à 5% max par pari, réduire si pas de value
                if (edgePercent < 0) {
                    kellyFraction = 0; // Pas de mise recommandée si pas de value
                } else {
                    kellyFraction = Math.min(kellyFraction, 0.05);
                }
                
                // Répartir le budget selon Kelly
                const stake = Math.round(userBalance * kellyFraction) || (edgePercent >= 0 ? Math.round(maxBudget / options.length) : 0);
                
                return {
                    option: opt.option,
                    odds: odds,
                    stake: stake,
                    adjustedStake: stake,
                    potentialReturn: Math.round(stake * odds),
                    kellyPercentage: Math.round(kellyFraction * 100 * 10) / 10,
                    probability: prob,
                    edge: edgePercent,
                    edgeValue: edge,
                    riskLevel: opt.riskLevel || riskLevel,
                    dangerLevel: dangerLevel,
                    isValueBet: edgePercent >= 0,
                    reasoning: opt.reasoning || (edgePercent >= 6 
                        ? `Excellente value (+${edgePercent}% EDGE)` 
                        : edgePercent >= 0 
                            ? `Value bet modéré (+${edgePercent}% EDGE)` 
                            : `Pas de value (${edgePercent}% EDGE) - À éviter`)
                };
            });
            
            // Filtrer les options sans value pour le récap mais les garder pour affichage
            const valueBets = calculatedStakes.filter(s => s.isValueBet);
            const totalStake = valueBets.reduce((sum, s) => sum + s.stake, 0);
            
            prediction.stakes = {
                totalBudget: totalStake,
                totalStake: totalStake,
                maxBudgetAllowed: maxBudget,
                stakes: calculatedStakes,
                valueBetsCount: valueBets.length,
                totalOptions: calculatedStakes.length,
                expectedValue: Math.round(totalStake * 0.12),
                expectedROI: 12,
                riskLevel: valueBets.length === 0 ? 'high' : (valueBets.some(s => s.edge >= 6) ? 'low' : 'medium'),
                calculations: `Calculé avec Kelly + EDGE sur ${calculatedStakes.length} options (${valueBets.length} value bets)`
            };
            
            console.log(`✅ Stakes calculated:`, prediction.stakes.stakes.map(s => `${s.option}: ${s.stake} FCFA (EDGE: ${s.edge}%)`));
        }
        // ================================================

        // Sauvegarder la prédiction dans Firebase
        const predictionData = {
            userId: req.user.uid,
            opportunityId,
            matchInfo: {
                homeTeam: matchData.homeTeam || 'Équipe A',
                awayTeam: matchData.awayTeam || 'Équipe B',
                fixtureId: matchData.fixtureId || matchData.id,
                league: matchData.league || 'Championnat',
                matchDate: matchData.matchDate || new Date().toISOString()
            },
            userBalance,
            bookmaker: bookmaker || 'default',
            aiAnalysis: prediction.matchAnalysis || null,
            oddsAnalysis: prediction.oddsAnalysis || null,
            synthesis: prediction.synthesis || null,
            stakes: prediction.stakes || null,
            selectedBookmaker: prediction.selectedBookmaker || null,
            selectedOptions: [],
            status: 'analyzed', // Analyse terminée, en attente de validation
            analyzedAt: new Date().toISOString(),
            isDemo: prediction.isDemo || false,
            aiEngines: {
                primary: "Claude (Extended Thinking)",
                secondary: "DeepSeek (Reasoner)"
            }
        };

        let savedPrediction;
        try {
            if (firestoreService) {
                savedPrediction = await firestoreService.createPrediction(predictionData);
                
                // Envoyer une notification que l'analyse est terminée
                try {
                    await sendNotificationToUser(req.user.uid, {
                        type: 'analysis_complete',
                        title: '✅ Analyse terminée',
                        body: `L'analyse de ${matchData.homeTeam || 'Match'} vs ${matchData.awayTeam || ''} est prête.`,
                        data: { 
                            predictionId: savedPrediction.id,
                            matchInfo: `${matchData.homeTeam || 'Match'} vs ${matchData.awayTeam || ''}`
                        }
                    });
                } catch (notifError) {
                    console.warn("⚠️ Could not send notification:", notifError.message);
                }
            } else {
                savedPrediction = { id: `pred_${Date.now()}`, ...predictionData };
            }
        } catch (saveError) {
            console.error("❌ Error saving prediction to Firebase:", saveError.message);
            // Retourner quand même la prédiction sans la sauvegarder
            savedPrediction = { id: `temp_${Date.now()}`, ...predictionData, saveError: saveError.message };
        }

        console.log(`✅ Analysis complete! Prediction ID: ${savedPrediction.id}\n`);

        res.json({ prediction: savedPrediction });

    } catch (error) {
        console.error("❌ Error analyzing prediction:", error);
        console.error("   Stack:", error.stack);
        
        // Retourner une prédiction mock en cas d'erreur totale
        try {
            const mockPrediction = generateMockPrediction(
                { homeTeam: 'Équipe A', awayTeam: 'Équipe B', id: req.body.opportunityId },
                req.body.userBalance || 10000,
                req.body.bookmaker
            );
            mockPrediction.id = `error_${Date.now()}`;
            mockPrediction.isDemo = true;
            mockPrediction.error = error.message;
            
            console.log("📦 Returning mock prediction due to error");
            return res.json({ prediction: mockPrediction, isDemo: true, error: error.message });
        } catch (mockError) {
            // Si même le mock échoue, retourner l'erreur
            res.status(500).json({ 
                error: "Failed to analyze prediction", 
                details: error.message,
                suggestion: "Vérifiez que les clés API sont configurées sur Render"
            });
        }
    }
});

/**
 * Helper: Génère une prédiction mock quand l'IA n'est pas configurée
 */
function generateMockPrediction(matchData, userBalance, bookmaker) {
    const homeTeam = matchData.homeTeam || 'Équipe A';
    const awayTeam = matchData.awayTeam || 'Équipe B';
    
    // Calculer les stakes basées sur Kelly
    const stake1 = Math.round(userBalance * 0.025);
    const stake2 = Math.round(userBalance * 0.020);
    const stake3 = Math.round(userBalance * 0.015);
    const totalBudget = stake1 + stake2 + stake3;
    
    return {
        matchAnalysis: {
            claude: {
                enjeu: {
                    teamA: { description: "Match important pour le classement", motivation: "high" },
                    teamB: { description: "Cherche à surprendre", motivation: "medium" }
                },
                btts: { probability: 0.65, prediction: "oui", analysis: "Les deux équipes marquent régulièrement" },
                winner: { 
                    prediction: "teamA", 
                    teamA: { probability: 0.55, analysis: "Avantage domicile" },
                    teamB: { probability: 0.25, analysis: "Moins performant à l'extérieur" },
                    draw: { probability: 0.20, analysis: "Possible mais peu probable" }
                },
                totalGoals: { expected: 2.8, over25: 0.68, over15: 0.85 },
                _thinking: "[Mode démo - Aucune réflexion IA réelle]"
            },
            deepseek: {
                btts: { probability: 0.62 },
                winner: { prediction: "teamA", confidence: "medium" },
                _thinking: "[Mode démo - Aucune réflexion IA réelle]"
            }
        },
        oddsAnalysis: {
            recommendedOptions: [
                { option: `Victoire ${homeTeam}`, odds: 1.45, estimatedProbability: 0.55, riskLevel: "low", value: 1.20 },
                { option: "Plus de 2.5 buts", odds: 1.70, estimatedProbability: 0.68, riskLevel: "medium", value: 1.15 },
                { option: "BTTS Oui", odds: 1.85, estimatedProbability: 0.65, riskLevel: "medium", value: 1.21 }
            ],
            bestValue: "BTTS Oui",
            safestOption: `Victoire ${homeTeam}`
        },
        synthesis: {
            synthesis: "Les deux IA s'accordent sur une victoire probable de l'équipe à domicile avec des buts des deux côtés",
            consensusPoints: ["Victoire domicile probable", "Match avec des buts", "BTTS probable"],
            divergencePoints: [],
            coverageScore: 0.75
        },
        stakes: {
            totalBudget: totalBudget,
            totalStake: totalBudget,
            maxBudgetAllowed: Math.round(userBalance * 0.06),
            stakes: [
                { 
                    option: `Victoire ${homeTeam}`, 
                    odds: 1.45, 
                    stake: stake1,
                    adjustedStake: stake1, 
                    potentialReturn: Math.round(stake1 * 1.45),
                    kellyPercentage: 2.5
                },
                { 
                    option: "Plus de 2.5 buts", 
                    odds: 1.70, 
                    stake: stake2,
                    adjustedStake: stake2,
                    potentialReturn: Math.round(stake2 * 1.70),
                    kellyPercentage: 2.0
                },
                { 
                    option: "BTTS Oui", 
                    odds: 1.85, 
                    stake: stake3,
                    adjustedStake: stake3,
                    potentialReturn: Math.round(stake3 * 1.85),
                    kellyPercentage: 1.5
                }
            ],
            expectedValue: Math.round(totalBudget * 0.15),
            riskLevel: "medium"
        },
        selectedBookmaker: {
            key: bookmaker || 'default',
            name: bookmaker ? bookmaker.charAt(0).toUpperCase() + bookmaker.slice(1) : 'Default',
            odds: {},
            optionsCount: 15
        }
    };
}

/**
 * Helper: Retourne des données mock pour un match
 */
function getMockMatchData() {
    return {
        id: "mock_match_001",
        homeTeam: "PSG",
        awayTeam: "Marseille",
        league: "Ligue 1",
        venue: "au Parc des Princes",
        matchDate: new Date(Date.now() + 86400000).toISOString(),
        fixtureId: 123456,
        stats: {
            standings: {
                equipe_A: { rang: 1, points: 34 },
                equipe_B: { rang: 3, points: 28 }
            }
        },
        odds: {
            default: {
                "Victoire PSG": 1.45,
                "Match Nul": 4.50,
                "Victoire Marseille": 6.00,
                "BTTS Oui": 1.85,
                "Plus de 2.5 buts": 1.70
            }
        }
    };
}

/**
 * PUT /api/predictions/:id/select-options
 * Enregistre les options sélectionnées par l'utilisateur
 * Crée la prédiction si elle n'existe pas (cas des prédictions demo_)
 */
app.put('/api/predictions/:id/select-options', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { selectedOptions, predictionData } = req.body;

        if (!selectedOptions || !Array.isArray(selectedOptions)) {
            return res.status(400).json({ error: "selectedOptions array is required" });
        }

        console.log(`📋 Selecting options for prediction ${id}`);
        console.log(`   Options: ${selectedOptions.length} selected`);

        if (firestoreService) {
            // Log de l'action
            try {
                await firestoreService.logUserAction(req.user.uid, 'select_options', {
                    predictionId: id,
                    optionsCount: selectedOptions.length
                }, { predictionId: id });
            } catch (logError) {
                console.warn("⚠️ Could not log action:", logError.message);
            }

            // Vérifier si la prédiction existe
            let existingPrediction = await firestoreService.getPredictionById(id);
            
            if (!existingPrediction) {
                // La prédiction n'existe pas (cas demo_) - la créer
                console.log(`📝 Creating new prediction document: ${id}`);
                
                const newPredictionData = {
                    userId: req.user.uid,
                    selectedOptions,
                    status: 'active',
                    validatedAt: new Date().toISOString(),
                    // Inclure les données additionnelles si fournies
                    ...(predictionData || {}),
                    isDemo: id.startsWith('demo_') || id.startsWith('temp_') || id.startsWith('error_')
                };
                
                await firestoreService.db.collection('predictions').doc(id).set({
                    ...newPredictionData,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                
                existingPrediction = { id, ...newPredictionData };
            } else {
                // Mettre à jour la prédiction existante
                await firestoreService.updatePrediction(id, {
                    selectedOptions,
                    status: 'active',
                    validatedAt: new Date().toISOString()
                });
                
                existingPrediction = await firestoreService.getPredictionById(id);
            }

            console.log(`✅ Options saved for prediction ${id}`);
            res.json({ prediction: existingPrediction });
        } else {
            res.json({ prediction: { id, selectedOptions, status: 'active' } });
        }

    } catch (error) {
        console.error("Error selecting options:", error);
        res.status(500).json({ error: "Failed to select options", details: error.message });
    }
});

/**
 * POST /api/predictions/:id/validate
 * Valide les options sélectionnées par l'utilisateur
 * Crée la prédiction si elle n'existe pas (cas des prédictions demo_)
 */
app.post('/api/predictions/:id/validate', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { selectedOptions, predictionData } = req.body;

        if (!selectedOptions || !Array.isArray(selectedOptions)) {
            return res.status(400).json({ error: "selectedOptions array is required" });
        }

        console.log(`✅ Validating options for prediction ${id}`);
        console.log(`   Options: ${selectedOptions.length} validated`);

        if (firestoreService) {
            // Log de l'action
            try {
                await firestoreService.logUserAction(req.user.uid, 'validate_options', {
                    predictionId: id,
                    optionsCount: selectedOptions.length
                }, { predictionId: id });
            } catch (logError) {
                console.warn("⚠️ Could not log action:", logError.message);
            }

            // Vérifier si la prédiction existe
            let existingPrediction = await firestoreService.getPredictionById(id);
            
            if (!existingPrediction) {
                // La prédiction n'existe pas (cas demo_) - la créer
                console.log(`📝 Creating new prediction document: ${id}`);
                
                const newPredictionData = {
                    userId: req.user.uid,
                    selectedOptions,
                    status: 'active',
                    validatedAt: new Date().toISOString(),
                    // Inclure les données additionnelles si fournies
                    ...(predictionData || {}),
                    isDemo: id.startsWith('demo_') || id.startsWith('temp_') || id.startsWith('error_')
                };
                
                await firestoreService.db.collection('predictions').doc(id).set({
                    ...newPredictionData,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                
                existingPrediction = { id, ...newPredictionData };
            } else {
                // Mettre à jour la prédiction existante
                await firestoreService.updatePrediction(id, {
                    selectedOptions,
                    status: 'active',
                    validatedAt: new Date().toISOString()
                });
                
                existingPrediction = await firestoreService.getPredictionById(id);
            }

            console.log(`✅ Options validated for prediction ${id}`);
            res.json({ success: true, prediction: existingPrediction });
        } else {
            res.json({ success: true, prediction: { id, selectedOptions, status: 'active' } });
        }

    } catch (error) {
        console.error("Error validating options:", error);
        res.status(500).json({ error: "Failed to validate options", details: error.message });
    }
});

/**
 * GET /api/predictions
 * Récupère les prédictions de l'utilisateur (dédupliquées et filtrées)
 */
app.get('/api/predictions', authMiddleware, async (req, res) => {
    try {
        const { status, includeFinished } = req.query;

        if (firestoreService) {
            let predictions = await firestoreService.getUserPredictions(req.user.uid, status);
            
            // Dédupliquer par MATCH (pas seulement par ID)
            // Garder la prédiction avec selectedOptions validées
            const matchMap = new Map();
            
            predictions.forEach(pred => {
                // Créer une clé unique pour le match
                const homeTeam = pred.matchInfo?.homeTeam || pred.meta?.homeTeam || '';
                const awayTeam = pred.matchInfo?.awayTeam || pred.meta?.awayTeam || '';
                const fixtureId = pred.matchInfo?.fixtureId || pred.meta?.matchId || pred.opportunityId || '';
                
                // Clé unique: fixtureId si disponible, sinon homeTeam vs awayTeam
                const matchKey = fixtureId ? `fixture_${fixtureId}` : `${homeTeam}_vs_${awayTeam}`.toLowerCase();
                
                if (!matchMap.has(matchKey)) {
                    matchMap.set(matchKey, pred);
                } else {
                    const existing = matchMap.get(matchKey);
                    
                    // Priorité: celle avec selectedOptions validées
                    const existingHasOptions = existing.selectedOptions?.length > 0;
                    const newHasOptions = pred.selectedOptions?.length > 0;
                    
                    if (newHasOptions && !existingHasOptions) {
                        matchMap.set(matchKey, pred);
                    }
                    else if (newHasOptions && existingHasOptions && pred.selectedOptions.length > existing.selectedOptions.length) {
                        matchMap.set(matchKey, pred);
                    }
                    else if (!newHasOptions && !existingHasOptions) {
                        // Garder celle avec le statut le plus avancé ou la plus récente
                        if (pred.validatedAt && !existing.validatedAt) {
                            matchMap.set(matchKey, pred);
                        } else if (pred.status === 'active' && existing.status !== 'active') {
                            matchMap.set(matchKey, pred);
                        }
                    }
                }
            });
            
            predictions = Array.from(matchMap.values());
            console.log(`📋 Deduplicated predictions: ${matchMap.size} unique matches`);
            
            // Vérifier le statut live des matchs via API-Football si disponible
            if (liveFootballService && !includeFinished) {
                const updatedPredictions = [];
                
                for (const pred of predictions) {
                    const fixtureId = pred.matchInfo?.fixtureId || pred.meta?.matchId;
                    
                    // Vérifier le statut du match
                    if (fixtureId) {
                        try {
                            const liveData = await liveFootballService.getMatchStatus(fixtureId);
                            
                            if (liveData && !liveData.isDemo) {
                                // Mettre à jour le statut live dans la prédiction
                                pred.liveStatus = {
                                    matchStatus: {
                                        status: liveData.status,
                                        elapsed: liveData.elapsed,
                                        score: liveData.score,
                                        hasStarted: liveData.hasStarted,
                                        isFinished: liveData.isFinished,
                                        canHedge: liveData.canHedge
                                    },
                                    lastChecked: new Date().toISOString()
                                };
                                
                                // Exclure les matchs terminés sauf si demandé
                                if (liveData.isFinished) {
                                    // Mettre à jour le statut dans Firebase
                                    const newStatus = pred.selectedOptions?.length > 0 ? 'finished' : 'cancelled';
                                    await firestoreService.updatePrediction(pred.id, { 
                                        status: newStatus,
                                        liveStatus: pred.liveStatus,
                                        finishedAt: new Date().toISOString()
                                    });
                                    continue; // Ne pas inclure dans la réponse
                                }
                            }
                        } catch (err) {
                            console.warn(`Could not check live status for fixture ${fixtureId}:`, err.message);
                        }
                    }
                    
                    updatedPredictions.push(pred);
                }
                
                predictions = updatedPredictions;
            }
            
            // Filtrer les prédictions terminées côté serveur aussi
            predictions = predictions.filter(p => {
                const st = p.status?.toLowerCase();
                return st !== 'won' && st !== 'lost' && st !== 'finished' && st !== 'cancelled';
            });
            
            res.json({ predictions });
        } else {
            res.json({
                predictions: [{
                    id: "pred_mock",
                    matchInfo: { homeTeam: "PSG", awayTeam: "Marseille" },
                    selectedOptions: [{ option: "Victoire PSG", stake: 500, odds: 1.45 }],
                    status: "active"
                }]
            });
        }
    } catch (error) {
        console.error("Error fetching predictions:", error);
        res.status(500).json({ error: "Failed to fetch predictions" });
    }
});

/**
 * GET /api/predictions/:id
 * Récupère une prédiction spécifique
 */
app.get('/api/predictions/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        if (firestoreService) {
            const prediction = await firestoreService.getPredictionById(id);
            if (!prediction) {
                return res.status(404).json({ error: "Prediction not found" });
            }
            res.json({ prediction });
        } else {
            res.json({ prediction: { id, status: "active" } });
        }
    } catch (error) {
        console.error("Error fetching prediction:", error);
        res.status(500).json({ error: "Failed to fetch prediction" });
    }
});

// ============== ROUTES - LIVE / HEDGING ==============

/**
 * GET /api/live/:fixtureId
 * Récupère les données live d'un match depuis API-Football
 */
app.get('/api/live/:fixtureId', authMiddleware, async (req, res) => {
    try {
        const { fixtureId } = req.params;

        if (!liveFootballService) {
            return res.status(503).json({ error: "Live service not available" });
        }

        const liveData = await liveFootballService.getFullLiveData(parseInt(fixtureId));
        res.json({ liveData });

    } catch (error) {
        console.error("Error fetching live data:", error);
        res.status(500).json({ error: "Failed to fetch live data", details: error.message });
    }
});

/**
 * GET /api/live/:fixtureId/odds
 * Récupère les cotes live depuis API-Football
 */
app.get('/api/live/:fixtureId/odds', authMiddleware, async (req, res) => {
    try {
        const { fixtureId } = req.params;
        const { bookmaker } = req.query;

        if (!liveFootballService) {
            return res.status(503).json({ error: "Live service not available" });
        }

        const bookmakerId = bookmaker 
            ? LiveFootballService.getBookmakerId(bookmaker) 
            : null;

        const odds = await liveFootballService.getLiveOdds(parseInt(fixtureId), bookmakerId);
        res.json({ odds });

    } catch (error) {
        console.error("Error fetching live odds:", error);
        res.status(500).json({ error: "Failed to fetch live odds" });
    }
});

/**
 * POST /api/hedging/strategy
 * Calcule la stratégie de couverture avec données live
 * IMPORTANT: Vérifie que le match a commencé et est au moins à la mi-temps
 */
app.post('/api/hedging/strategy', authMiddleware, async (req, res) => {
    try {
        // Accepter les deux formats (ancien et nouveau)
        const { 
            predictionId, 
            cashouts: oldCashouts,  // Ancien format
            options: frontendOptions,  // Nouveau format
            liveScore,
            withCashouts 
        } = req.body;

        console.log("🛡️ Hedging strategy request:", { predictionId, hasOptions: !!frontendOptions, withCashouts });

        if (!predictionId) {
            return res.status(400).json({ error: "predictionId is required" });
        }

        // Récupérer la prédiction
        let prediction;
        if (firestoreService) {
            prediction = await firestoreService.getPredictionById(predictionId);
            if (!prediction) {
                return res.status(404).json({ error: "Prediction not found" });
            }
        } else {
            prediction = {
                matchInfo: { fixtureId: 123456, homeTeam: "PSG", awayTeam: "Marseille" },
                selectedOptions: [{ option: "Victoire PSG", stake: 500, odds: 1.45 }]
            };
        }

        const fixtureId = prediction.matchInfo?.fixtureId || prediction.meta?.matchId;
        const matchInfo = prediction.matchInfo || prediction.meta || {};

        // Construire les options à analyser (depuis le frontend ou la prédiction)
        const optionsToAnalyze = frontendOptions || prediction.selectedOptions || [];
        
        // Construire les cashouts de manière sécurisée (éviter undefined)
        const safeCashouts = {};
        if (oldCashouts && typeof oldCashouts === 'object') {
            Object.keys(oldCashouts).forEach(key => {
                if (oldCashouts[key] !== undefined && oldCashouts[key] !== null && oldCashouts[key] !== '') {
                    safeCashouts[key] = parseFloat(oldCashouts[key]) || 0;
                }
            });
        }
        // Ajouter les cashouts des options frontend
        if (frontendOptions) {
            frontendOptions.forEach((opt, i) => {
                if (opt.cashout !== undefined && opt.cashout !== null) {
                    safeCashouts[`option_${i}`] = opt.cashout;
                    safeCashouts[opt.option] = opt.cashout;
                }
            });
        }

        // ========== VÉRIFICATION DU STATUT DU MATCH ==========
        let matchStatus = null;
        let liveData = null;
        
        if (liveFootballService && fixtureId) {
            try {
                matchStatus = await liveFootballService.getMatchStatus(parseInt(fixtureId));
                
                if (matchStatus && !matchStatus.canHedge) {
                    let message = "";
                    let waitTime = null;

                    if (!matchStatus.hasStarted) {
                        message = "Le match n'a pas encore commencé. La stratégie de couverture sera disponible à partir de la mi-temps.";
                    } else if (matchStatus.elapsed < 40) {
                        const minutesLeft = 40 - matchStatus.elapsed;
                        message = `Match en cours (${matchStatus.elapsed}'). La stratégie sera disponible dans environ ${minutesLeft} minutes.`;
                        waitTime = minutesLeft * 60 * 1000;
                    } else {
                        message = "La stratégie de couverture n'est pas encore disponible pour ce match.";
                    }

                    return res.status(403).json({
                        error: "hedging_not_available",
                        message,
                        matchStatus: {
                            status: matchStatus.status,
                            statusLong: matchStatus.statusLong,
                            elapsed: matchStatus.elapsed,
                            hasStarted: matchStatus.hasStarted,
                            canHedge: false,
                            score: matchStatus.score,
                            waitTime
                        }
                    });
                }

                // Récupérer les données live complètes
                liveData = await liveFootballService.getFullLiveData(parseInt(fixtureId));
                
                // Si pas de cotes live, essayer les cotes pré-match
                if (!liveData?.odds || liveData.odds.length === 0) {
                    console.log("⚠️ No live odds, trying pre-match odds...");
                    try {
                        const preMatchOdds = await liveFootballService.getPreMatchOdds(parseInt(fixtureId));
                        if (preMatchOdds) {
                            liveData = liveData || {};
                            liveData.preMatchOdds = preMatchOdds;
                            console.log("✅ Pre-match odds retrieved");
                        }
                    } catch (oddsError) {
                        console.warn("Could not get pre-match odds:", oddsError.message);
                    }
                } else {
                    console.log("✅ Live odds available:", Object.keys(liveData.odds[0]?.bookmakers || {}).length, "bookmakers");
                }
            } catch (error) {
                console.warn("⚠️ Could not fetch live data:", error.message);
            }
        }

        // Formater les cotes pour le prompt
        let oddsDescription = "Non disponibles";
        if (liveData?.odds && liveData.odds.length > 0) {
            const firstBookmaker = liveData.odds[0];
            oddsDescription = `Cotes LIVE: ${JSON.stringify(firstBookmaker.bookmakers || {}, null, 2)}`;
        } else if (liveData?.preMatchOdds) {
            // Prendre le premier bookmaker des cotes pré-match
            const bookmakerNames = Object.keys(liveData.preMatchOdds);
            if (bookmakerNames.length > 0) {
                const firstBm = bookmakerNames[0];
                oddsDescription = `Cotes pré-match (${firstBm}): ${JSON.stringify(liveData.preMatchOdds[firstBm], null, 2)}`;
            }
        }

        // Utiliser le score du frontend si pas de données live
        const currentScore = liveData?.match?.score || liveScore || { home: 0, away: 0 };
        const currentElapsed = matchStatus?.elapsed || liveScore?.elapsed || 45;

        // Log de l'action (avec valeurs sécurisées)
        if (firestoreService) {
            try {
                await firestoreService.logUserAction(req.user.uid, 'request_hedging', {
                    predictionId,
                    optionsCount: optionsToAnalyze.length,
                    hasCashouts: Object.keys(safeCashouts).length > 0,
                    matchTime: `${currentElapsed}'`,
                    score: `${currentScore.home || 0}-${currentScore.away || 0}`
                }, { predictionId });
            } catch (logError) {
                console.warn("⚠️ Could not log action:", logError.message);
            }
        }

        // ========== CALCUL DE LA STRATÉGIE AVEC DEEPSEEK ==========
        let strategy;
        
        // Calculer les données de base pour les stratégies
        const totalInvested = optionsToAnalyze.reduce((sum, opt) => sum + (opt.stake || 0), 0);
        const totalPotentialProfit = optionsToAnalyze.reduce((sum, opt) => sum + Math.round((opt.stake || 0) * ((opt.odds || 1.5) - 1)), 0);
        const totalPotentialReturn = totalInvested + totalPotentialProfit;
        const totalCashoutAvailable = Object.values(safeCashouts).reduce((sum, c) => sum + (parseFloat(c) || 0), 0);
        
        // Préparer le prompt pour DeepSeek Reasoner - MULTIPLE STRATÉGIES
        const hedgingPrompt = `Tu es un expert en paris sportifs et stratégies de couverture (hedging). Analyse la situation et propose PLUSIEURS stratégies avec des calculs détaillés.

## MATCH EN COURS
- **${matchInfo.homeTeam || 'Équipe A'}** vs **${matchInfo.awayTeam || 'Équipe B'}**
- Score actuel: ${currentScore.home || 0} - ${currentScore.away || 0}
- Temps écoulé: ${currentElapsed}'
- Championnat: ${matchInfo.league || 'N/A'}

## MES PARIS EN COURS
${optionsToAnalyze.map((opt, i) => `
### Option ${i + 1}: ${opt.option}
- Mise initiale: ${opt.stake || 0} FCFA
- Cote initiale: ${opt.odds || 1.5}
- Retour potentiel: ${Math.round((opt.stake || 0) * (opt.odds || 1.5))} FCFA
- Profit potentiel: ${Math.round((opt.stake || 0) * ((opt.odds || 1.5) - 1))} FCFA
- Cashout proposé: ${safeCashouts[`option_${i}`] || safeCashouts[opt.option] || 'Non disponible'}
`).join('\n')}

## TOTAUX
- Total investi: ${totalInvested} FCFA
- Profit potentiel total: ${totalPotentialProfit} FCFA
- Retour potentiel total: ${totalPotentialReturn} FCFA
- Cashout total disponible: ${totalCashoutAvailable || 'Non renseigné'} FCFA

## STATS LIVE
${liveData?.statistics ? JSON.stringify(LiveFootballService.formatLiveStatsForDisplay(liveData.statistics), null, 2) : 'Non disponibles'}

## COTES DISPONIBLES POUR HEDGE
${oddsDescription}

## INSTRUCTIONS IMPORTANTES
Tu dois proposer EXACTEMENT 4 STRATÉGIES différentes avec pour chacune:
1. Les calculs détaillés avec formules
2. Les scénarios de profit/perte
3. Le niveau de risque
4. Les avantages et inconvénients

Les 4 stratégies OBLIGATOIRES:
1. **HOLD** - Garder tous les paris (risque max, profit max)
2. **CASHOUT** - Encaisser maintenant (sécurité immédiate)
3. **HEDGE_PARTIEL** - Couvrir partiellement pour réduire le risque
4. **HEDGE_TOTAL** - Couvrir totalement pour garantir un profit

Réponds UNIQUEMENT en JSON valide avec cette structure:
{
    "matchAnalysis": {
        "currentSituation": "Description de la situation actuelle du match",
        "trendsObserved": "Tendances observées (possession, tirs, momentum)",
        "riskAssessment": "Évaluation du risque global"
    },
    "optionsStatus": [
        {
            "option": "Nom de l'option",
            "status": "winning|losing|pending|won|lost",
            "probability": 0.0,
            "analysis": "Pourquoi ce statut"
        }
    ],
    "strategies": [
        {
            "id": "hold",
            "name": "🎯 MAINTENIR",
            "description": "Garder tous les paris jusqu'à la fin",
            "riskLevel": "high|medium|low",
            "riskScore": 8,
            "recommended": false,
            "calculations": {
                "formula": "Profit = Σ(Mise × Cote) - Total investi",
                "details": [
                    "Si tous gagnants: +X FCFA",
                    "Si tous perdants: -Y FCFA"
                ],
                "expectedValue": 0,
                "variance": 0
            },
            "scenarios": [
                {
                    "name": "Tous gagnants",
                    "probability": 0.0,
                    "profit": 0,
                    "explanation": "Calcul détaillé..."
                }
            ],
            "actions": [],
            "pros": ["Avantage 1", "Avantage 2"],
            "cons": ["Inconvénient 1", "Inconvénient 2"],
            "summary": "Résumé de la stratégie"
        }
    ],
    "recommendedStrategy": "hold|cashout|hedge_partiel|hedge_total",
    "confidence": 0.0,
    "reasoning": "Explication du choix de la stratégie recommandée",
    "summary": "Conseil final concis"
}`;

        if (predictionService && predictionService.deepseekKey) {
            try {
                console.log("🧠 Calculating hedging strategies with DeepSeek Reasoner...");
                
                // Utiliser DeepSeek Reasoner
                const deepseekResult = await callDeepSeek(
                    hedgingPrompt,
                    predictionService.deepseekKey,
                    "Tu es un expert en paris sportifs spécialisé dans les stratégies de couverture (hedging). Tu calcules avec précision et tu proposes plusieurs options avec leurs calculs détaillés. Tu donnes des conseils clairs et actionnables.",
                    true  // Utiliser le mode Reasoner
                );
                
                strategy = deepseekResult;
                strategy.isDemo = false;
                strategy.generatedAt = new Date().toISOString();
                strategy.engine = "deepseek-reasoner";
                
                console.log("✅ DeepSeek strategies calculated successfully");
                
            } catch (deepseekError) {
                console.warn("⚠️ DeepSeek error, falling back to calculated strategies:", deepseekError.message);
                strategy = generateCalculatedHedgingStrategies(optionsToAnalyze, currentScore, currentElapsed, safeCashouts, liveData, matchInfo);
            }
        } else {
            // Générer des stratégies calculées si pas d'API
            console.log("📊 Generating calculated hedging strategies...");
            strategy = generateCalculatedHedgingStrategies(optionsToAnalyze, currentScore, currentElapsed, safeCashouts, liveData, matchInfo);
        }

        // Envoyer une notification
        if (firestoreService) {
            try {
                await sendNotificationToUser(req.user.uid, {
                    type: 'hedging_ready',
                    title: '🛡️ Stratégie de couverture prête',
                    body: `Recommandation: ${strategy.recommendation?.toUpperCase() || 'ANALYSER'}`,
                    data: { predictionId }
                });
                
                // ========== VERROUILLER L'ANALYSE DE COUVERTURE ==========
                // Marquer la prédiction comme ayant reçu une analyse de couverture
                await firestoreService.updatePrediction(predictionId, {
                    hedgingAnalyzed: true,
                    hedgingAnalyzedAt: new Date().toISOString(),
                    hedgingStrategy: strategy,
                    hedgingLiveData: {
                        score: currentScore,
                        elapsed: currentElapsed,
                        statistics: liveData?.statistics || null,
                        odds: liveData?.odds || null,
                        preMatchOdds: liveData?.preMatchOdds || null
                    }
                });
                console.log(`✅ Prediction ${predictionId} marked as hedgingAnalyzed`);
                
            } catch (notifError) {
                console.warn("Could not send notification or update prediction:", notifError.message);
            }
        }

        res.json({ 
            strategy,
            liveData: {
                score: `${currentScore.home || 0} - ${currentScore.away || 0}`,
                matchTime: `${currentElapsed}'`,
                status: matchStatus?.statusLong || 'En cours',
                statistics: liveData?.statistics || null,
                odds: liveData?.odds || null,
                preMatchOdds: liveData?.preMatchOdds || null,
                oddsAvailable: !!(liveData?.odds?.length > 0 || liveData?.preMatchOdds)
            },
            hedgingAllowed: true,
            hedgingAnalyzed: true  // Indiquer que l'analyse est faite
        });

    } catch (error) {
        console.error("❌ Error calculating hedging strategy:", error);
        res.status(500).json({ 
            error: "Failed to calculate hedging strategy", 
            details: error.message,
            // Renvoyer une stratégie de secours
            strategy: {
                recommendation: "monitor",
                confidence: 0.5,
                analysis: "Une erreur s'est produite. Surveillez le match et prenez une décision manuelle.",
                options: [],
                summary: "Erreur technique - Décision manuelle recommandée",
                isDemo: true,
                error: true
            }
        });
    }
});

// Fonction helper pour générer des stratégies de hedging calculées
function generateCalculatedHedgingStrategies(options, score, elapsed, cashouts, liveData, matchInfo) {
    const homeScore = score?.home || 0;
    const awayScore = score?.away || 0;
    const totalGoals = homeScore + awayScore;
    const timeRemaining = 90 - elapsed;
    
    // Calculs de base
    const totalInvested = options.reduce((sum, opt) => sum + (opt.stake || 0), 0);
    const totalPotentialProfit = options.reduce((sum, opt) => sum + Math.round((opt.stake || 0) * ((opt.odds || 1.5) - 1)), 0);
    const totalPotentialReturn = totalInvested + totalPotentialProfit;
    const totalCashout = Object.values(cashouts).reduce((sum, c) => sum + (parseFloat(c) || 0), 0);
    
    // Analyser le statut de chaque option
    const optionsStatus = options.map((opt, i) => {
        const optLower = (opt.option || '').toLowerCase();
        let status = "pending";
        let probability = 0.5;
        let analysis = "";
        
        // Logique de statut basée sur le type de pari et le score
        if (optLower.includes('plus de 2.5') || optLower.includes('over 2.5')) {
            if (totalGoals > 2) {
                status = "won";
                probability = 1;
                analysis = `✅ Pari GAGNÉ - ${totalGoals} buts marqués (>2.5)`;
            } else if (totalGoals === 2) {
                probability = elapsed < 70 ? 0.5 : 0.3;
                status = "pending";
                analysis = `⏳ 2 buts - Il faut encore 1 but en ${timeRemaining}min`;
            } else {
                probability = elapsed < 60 ? 0.4 : 0.2;
                status = elapsed > 75 ? "losing" : "pending";
                analysis = `⚠️ ${totalGoals} but(s) - Difficile avec ${timeRemaining}min restantes`;
            }
        } else if (optLower.includes('moins de 2.5') || optLower.includes('under 2.5')) {
            if (totalGoals > 2) {
                status = "lost";
                probability = 0;
                analysis = `❌ Pari PERDU - ${totalGoals} buts marqués (>2.5)`;
            } else if (totalGoals === 2) {
                probability = elapsed > 75 ? 0.7 : 0.5;
                status = "pending";
                analysis = `⏳ 2 buts - Éviter un but en ${timeRemaining}min`;
            } else {
                probability = 0.7;
                status = "winning";
                analysis = `✅ En bonne voie - ${totalGoals} but(s), ${timeRemaining}min restantes`;
            }
        } else if (optLower.includes('btts') || optLower.includes('deux équipes')) {
            if (homeScore > 0 && awayScore > 0) {
                status = "won";
                probability = 1;
                analysis = `✅ Pari GAGNÉ - Les deux équipes ont marqué`;
            } else if (homeScore > 0 || awayScore > 0) {
                probability = elapsed < 70 ? 0.55 : 0.35;
                status = "pending";
                analysis = `⏳ ${homeScore > 0 ? 'Domicile' : 'Extérieur'} a marqué - Attendre l'autre`;
            } else {
                probability = elapsed < 60 ? 0.4 : 0.2;
                status = elapsed > 75 ? "losing" : "pending";
                analysis = `⚠️ 0-0 - BTTS devient difficile`;
            }
        } else if (optLower.includes('victoire') && (optLower.includes('domicile') || optLower.includes(matchInfo?.homeTeam?.toLowerCase() || ''))) {
            if (homeScore > awayScore) {
                probability = elapsed > 70 ? 0.85 : 0.7;
                status = "winning";
                analysis = `✅ En tête ${homeScore}-${awayScore}`;
            } else if (homeScore === awayScore) {
                probability = 0.35;
                status = "pending";
                analysis = `⏳ Match nul ${homeScore}-${awayScore}`;
            } else {
                probability = elapsed > 70 ? 0.1 : 0.25;
                status = "losing";
                analysis = `⚠️ Mené ${homeScore}-${awayScore}`;
            }
        } else if (optLower.includes('nul') || optLower.includes('draw')) {
            if (homeScore === awayScore) {
                probability = elapsed > 75 ? 0.75 : 0.5;
                status = "winning";
                analysis = `✅ Match nul ${homeScore}-${awayScore}`;
            } else {
                probability = elapsed > 70 ? 0.15 : 0.3;
                status = "losing";
                analysis = `⚠️ Score ${homeScore}-${awayScore} - Pas nul`;
            }
        } else {
            analysis = `📊 Option en cours d'évaluation`;
        }
        
        return {
            option: opt.option,
            status,
            probability,
            analysis,
            stake: opt.stake || 0,
            odds: opt.odds || 1.5,
            potentialReturn: Math.round((opt.stake || 0) * (opt.odds || 1.5)),
            potentialProfit: Math.round((opt.stake || 0) * ((opt.odds || 1.5) - 1)),
            cashout: cashouts[`option_${options.indexOf(opt)}`] || cashouts[opt.option] || null
        };
    });
    
    // Probabilité moyenne de succès
    const avgWinProbability = optionsStatus.reduce((sum, o) => sum + o.probability, 0) / optionsStatus.length;
    
    // ========== STRATÉGIE 1: HOLD ==========
    const holdStrategy = {
        id: "hold",
        name: "🎯 MAINTENIR",
        description: "Garder tous les paris jusqu'à la fin du match",
        riskLevel: avgWinProbability > 0.6 ? "medium" : "high",
        riskScore: Math.round((1 - avgWinProbability) * 10),
        recommended: avgWinProbability > 0.65,
        calculations: {
            formula: "Profit = Σ(Mise × Cote) - Total investi",
            details: [
                `Total investi: ${totalInvested} FCFA`,
                `Si TOUS gagnants: +${totalPotentialProfit} FCFA`,
                `Si TOUS perdants: -${totalInvested} FCFA`,
                `Espérance: ${Math.round(totalPotentialProfit * avgWinProbability - totalInvested * (1 - avgWinProbability))} FCFA`
            ],
            expectedValue: Math.round(totalPotentialProfit * avgWinProbability - totalInvested * (1 - avgWinProbability)),
            variance: totalInvested + totalPotentialProfit
        },
        scenarios: [
            {
                name: "✅ Tous les paris gagnants",
                probability: Math.round(avgWinProbability * 100) / 100,
                profit: totalPotentialProfit,
                explanation: `Gain: ${totalPotentialReturn} - ${totalInvested} = +${totalPotentialProfit} FCFA`
            },
            {
                name: "❌ Tous les paris perdants",
                probability: Math.round((1 - avgWinProbability) * 100) / 100,
                profit: -totalInvested,
                explanation: `Perte totale de la mise: -${totalInvested} FCFA`
            }
        ],
        actions: [],
        pros: [
            "Profit maximum si les paris sont gagnants",
            "Pas de frais de cashout ou de hedge",
            "Simple - aucune action requise"
        ],
        cons: [
            "Risque de perte totale",
            "Aucune garantie de profit",
            "Stress jusqu'à la fin du match"
        ],
        summary: `Garder les ${options.length} paris. Profit potentiel: +${totalPotentialProfit} FCFA | Risque: -${totalInvested} FCFA`
    };
    
    // ========== STRATÉGIE 2: CASHOUT TOTAL ==========
    const cashoutProfit = totalCashout - totalInvested;
    const cashoutStrategy = {
        id: "cashout",
        name: "💰 CASHOUT TOTAL",
        description: "Encaisser tous les paris maintenant",
        riskLevel: "low",
        riskScore: 2,
        recommended: totalCashout > totalInvested && avgWinProbability < 0.5,
        calculations: {
            formula: "Profit = Cashout Total - Total investi",
            details: [
                `Total investi: ${totalInvested} FCFA`,
                `Cashout proposé: ${totalCashout || 'N/A'} FCFA`,
                `Profit immédiat: ${cashoutProfit > 0 ? '+' : ''}${cashoutProfit || 'N/A'} FCFA`,
                `% récupéré: ${totalCashout ? Math.round(totalCashout / totalInvested * 100) : 'N/A'}%`
            ],
            expectedValue: cashoutProfit || 0,
            variance: 0
        },
        scenarios: [
            {
                name: "💵 Cashout immédiat",
                probability: 1,
                profit: cashoutProfit || 0,
                explanation: totalCashout 
                    ? `${totalCashout} - ${totalInvested} = ${cashoutProfit > 0 ? '+' : ''}${cashoutProfit} FCFA (garanti)`
                    : "Cashout non disponible"
            }
        ],
        actions: optionsStatus.map(opt => ({
            option: opt.option,
            action: "CASHOUT",
            amount: opt.cashout || Math.round(opt.stake * 0.85),
            reason: "Sécuriser les fonds"
        })),
        pros: [
            "Profit/récupération garantie immédiatement",
            "Aucun risque de perte supplémentaire",
            "Tranquillité d'esprit"
        ],
        cons: [
            "Manque le profit maximum potentiel",
            totalCashout < totalInvested ? "Perte par rapport à la mise initiale" : "Profit limité",
            "Impossible de revenir en arrière"
        ],
        summary: totalCashout 
            ? `Encaisser ${totalCashout} FCFA maintenant (${cashoutProfit >= 0 ? '+' : ''}${cashoutProfit} FCFA de profit)`
            : "Cashout non disponible - Renseignez les valeurs de cashout"
    };
    
    // ========== STRATÉGIE 3: HEDGE PARTIEL ==========
    // Calculer une couverture partielle (50% de protection)
    const hedgePercentage = 0.5;
    const hedgeStakePartial = Math.round(totalPotentialReturn * hedgePercentage / 2); // Mise pour hedge
    const hedgeOdds = 2.0; // Cote moyenne pour le hedge
    const guaranteedProfitPartial = Math.round((totalPotentialProfit * (1 - hedgePercentage)) - hedgeStakePartial);
    const maxLossPartial = Math.round(totalInvested * hedgePercentage + hedgeStakePartial);
    
    const hedgePartialStrategy = {
        id: "hedge_partiel",
        name: "🛡️ HEDGE PARTIEL",
        description: "Couvrir 50% de la position pour réduire le risque",
        riskLevel: "medium",
        riskScore: 5,
        recommended: avgWinProbability >= 0.4 && avgWinProbability <= 0.6,
        calculations: {
            formula: "Hedge = (Retour potentiel × % couverture) ÷ Cote opposée",
            details: [
                `Couverture: ${hedgePercentage * 100}%`,
                `Mise de hedge: ${hedgeStakePartial} FCFA @ ${hedgeOdds}`,
                `Si pari initial gagne: +${Math.round(totalPotentialProfit - hedgeStakePartial)} FCFA`,
                `Si hedge gagne: -${Math.round(totalInvested - (hedgeStakePartial * hedgeOdds))} FCFA`,
                `Variance réduite de ${Math.round(hedgePercentage * 100)}%`
            ],
            expectedValue: Math.round((totalPotentialProfit - hedgeStakePartial) * avgWinProbability - maxLossPartial * (1 - avgWinProbability)),
            variance: Math.round((totalInvested + totalPotentialProfit) * (1 - hedgePercentage))
        },
        scenarios: [
            {
                name: "✅ Paris initiaux gagnants",
                probability: avgWinProbability,
                profit: Math.round(totalPotentialProfit - hedgeStakePartial),
                explanation: `Gain: ${totalPotentialProfit} - mise hedge ${hedgeStakePartial} = +${totalPotentialProfit - hedgeStakePartial} FCFA`
            },
            {
                name: "🛡️ Hedge gagne",
                probability: 1 - avgWinProbability,
                profit: Math.round(hedgeStakePartial * hedgeOdds - totalInvested - hedgeStakePartial),
                explanation: `Retour hedge: ${hedgeStakePartial * hedgeOdds} - pertes: ${totalInvested + hedgeStakePartial}`
            }
        ],
        actions: [
            {
                option: "Pari de couverture",
                action: "PLACER",
                bet: "Résultat opposé aux paris actuels",
                amount: hedgeStakePartial,
                odds: hedgeOdds,
                reason: "Réduire le risque de 50%"
            }
        ],
        pros: [
            "Réduit le risque tout en gardant du potentiel",
            "Équilibre entre sécurité et profit",
            "Permet de rester dans la partie"
        ],
        cons: [
            "Profit réduit si les paris initiaux gagnent",
            "Coût du hedge",
            "Complexité de l'exécution"
        ],
        summary: `Placer ${hedgeStakePartial} FCFA sur le résultat opposé. Profit réduit mais risque divisé par 2.`
    };
    
    // ========== STRATÉGIE 4: HEDGE TOTAL (Break-Even) ==========
    // Calculer la couverture totale pour garantir un profit
    const hedgeStakeTotal = Math.round(totalPotentialReturn / hedgeOdds);
    const guaranteedProfitTotal = Math.round(totalPotentialProfit - hedgeStakeTotal);
    const breakEvenIfHedgeWins = Math.round(hedgeStakeTotal * hedgeOdds - totalInvested - hedgeStakeTotal);
    
    const hedgeTotalStrategy = {
        id: "hedge_total",
        name: "🔒 HEDGE TOTAL",
        description: "Couverture complète pour garantir un profit minimum",
        riskLevel: "low",
        riskScore: 3,
        recommended: avgWinProbability > 0.5 && totalPotentialProfit > hedgeStakeTotal,
        calculations: {
            formula: "Hedge Total = Retour potentiel ÷ Cote opposée",
            details: [
                `Retour potentiel: ${totalPotentialReturn} FCFA`,
                `Mise de hedge nécessaire: ${hedgeStakeTotal} FCFA @ ${hedgeOdds}`,
                `Si pari initial gagne: +${guaranteedProfitTotal} FCFA`,
                `Si hedge gagne: ${breakEvenIfHedgeWins >= 0 ? '+' : ''}${breakEvenIfHedgeWins} FCFA`,
                `Profit garanti minimum: ${Math.min(guaranteedProfitTotal, breakEvenIfHedgeWins)} FCFA`
            ],
            expectedValue: Math.round((guaranteedProfitTotal + breakEvenIfHedgeWins) / 2),
            variance: Math.abs(guaranteedProfitTotal - breakEvenIfHedgeWins)
        },
        scenarios: [
            {
                name: "✅ Paris initiaux gagnants",
                probability: avgWinProbability,
                profit: guaranteedProfitTotal,
                explanation: `${totalPotentialReturn} - ${totalInvested} - ${hedgeStakeTotal} = +${guaranteedProfitTotal} FCFA`
            },
            {
                name: "🛡️ Hedge gagne",
                probability: 1 - avgWinProbability,
                profit: breakEvenIfHedgeWins,
                explanation: `${hedgeStakeTotal * hedgeOdds} - ${totalInvested} - ${hedgeStakeTotal} = ${breakEvenIfHedgeWins >= 0 ? '+' : ''}${breakEvenIfHedgeWins} FCFA`
            }
        ],
        actions: [
            {
                option: "Pari de couverture totale",
                action: "PLACER",
                bet: "Résultat opposé (ex: victoire adverse ou nul)",
                amount: hedgeStakeTotal,
                odds: hedgeOdds,
                reason: "Garantir un profit quel que soit le résultat"
            }
        ],
        pros: [
            "Profit garanti quel que soit le résultat",
            "Élimine le stress de la fin de match",
            "Stratégie professionnelle"
        ],
        cons: [
            "Profit limité comparé au HOLD",
            "Nécessite un capital supplémentaire",
            "Profit potentiellement faible si hedge gagne"
        ],
        summary: `Placer ${hedgeStakeTotal} FCFA pour garantir entre ${Math.min(guaranteedProfitTotal, breakEvenIfHedgeWins)} et ${Math.max(guaranteedProfitTotal, breakEvenIfHedgeWins)} FCFA de profit.`
    };
    
    // Déterminer la stratégie recommandée
    let recommendedStrategy = "hold";
    let reasoning = "";
    
    if (avgWinProbability >= 0.7) {
        recommendedStrategy = "hold";
        reasoning = "Probabilité élevée de succès - Maintenir pour maximiser le profit";
    } else if (avgWinProbability <= 0.3) {
        recommendedStrategy = totalCashout > totalInvested * 0.8 ? "cashout" : "hedge_total";
        reasoning = "Situation défavorable - Sécuriser les fonds";
    } else if (avgWinProbability > 0.5) {
        recommendedStrategy = "hedge_partiel";
        reasoning = "Situation favorable mais incertaine - Réduire le risque tout en gardant du potentiel";
    } else {
        recommendedStrategy = "hedge_total";
        reasoning = "Incertitude élevée - Garantir un profit minimum";
    }
    
    // Marquer la stratégie recommandée
    holdStrategy.recommended = recommendedStrategy === "hold";
    cashoutStrategy.recommended = recommendedStrategy === "cashout";
    hedgePartialStrategy.recommended = recommendedStrategy === "hedge_partiel";
    hedgeTotalStrategy.recommended = recommendedStrategy === "hedge_total";
    
    return {
        matchAnalysis: {
            currentSituation: `Score ${homeScore}-${awayScore} à la ${elapsed}'. ${timeRemaining} minutes restantes.`,
            trendsObserved: `${totalGoals} but(s) - Match ${totalGoals > 2 ? 'ouvert' : totalGoals === 0 ? 'fermé' : 'équilibré'}`,
            riskAssessment: `Probabilité moyenne de succès: ${Math.round(avgWinProbability * 100)}%`
        },
        optionsStatus,
        strategies: [holdStrategy, cashoutStrategy, hedgePartialStrategy, hedgeTotalStrategy],
        recommendedStrategy,
        confidence: avgWinProbability,
        reasoning,
        summary: elapsed >= 75 
            ? `Fin de match proche (${elapsed}'). ${recommendedStrategy === 'hold' ? 'Maintenir si en bonne voie.' : 'Envisager de sécuriser.'}`
            : `Match en cours (${elapsed}'). Stratégie recommandée: ${recommendedStrategy.toUpperCase()}`,
        calculations: {
            totalInvested,
            totalPotentialProfit,
            totalPotentialReturn,
            totalCashoutAvailable: totalCashout,
            avgWinProbability: Math.round(avgWinProbability * 100),
            timeRemaining
        },
        isDemo: true,
        generatedAt: new Date().toISOString(),
        engine: "calculated"
    };
}

// Ancienne fonction pour compatibilité
function generateMockHedgingStrategy(options, score, elapsed, cashouts) {
    return generateCalculatedHedgingStrategies(options, score, elapsed, cashouts, null, {});
}

/**
 * POST /api/hedging/apply
 * Applique une stratégie de couverture
 */
app.post('/api/hedging/apply', authMiddleware, async (req, res) => {
    try {
        const { predictionId, hedgingAction } = req.body;

        if (firestoreService) {
            // Enregistrer l'action de hedging
            await firestoreService.addHedgingAction(predictionId, hedgingAction);

            // Log de l'action
            await firestoreService.logUserAction(req.user.uid, 'apply_hedging', {
                predictionId,
                hedgingAction
            }, { predictionId });

            // Mettre à jour le statut
            await firestoreService.updatePrediction(predictionId, {
                status: 'hedged'
            });

            res.json({ success: true, message: "Hedging applied successfully" });
        } else {
            res.json({ success: true });
        }

    } catch (error) {
        console.error("Error applying hedging:", error);
        res.status(500).json({ error: "Failed to apply hedging" });
    }
});

/**
 * POST /api/hedging/break-even
 * Calcule les mises de couverture pour sortir à break-even
 * Utilise les cotes live actuelles
 */
app.post('/api/hedging/break-even', authMiddleware, async (req, res) => {
    try {
        const { predictionId } = req.body;

        if (!predictionId) {
            return res.status(400).json({ error: "predictionId is required" });
        }

        // Récupérer la prédiction
        let prediction;
        if (firestoreService) {
            prediction = await firestoreService.getPredictionById(predictionId);
            if (!prediction) {
                return res.status(404).json({ error: "Prediction not found" });
            }
        } else {
            prediction = {
                matchInfo: { fixtureId: 123456, homeTeam: "PSG", awayTeam: "Marseille" },
                selectedOptions: [{ option: "Plus de 2.5 buts", stake: 500, odds: 1.70 }]
            };
        }

        const fixtureId = prediction.matchInfo?.fixtureId || prediction.meta?.matchId;
        const selectedOptions = prediction.selectedOptions || [];

        if (selectedOptions.length === 0) {
            return res.status(400).json({ error: "No selected options found" });
        }

        // ========== RÉCUPÉRER LES COTES LIVE ==========
        let liveOdds = {};
        let matchStatus = null;
        let oddsSource = "fallback";
        
        if (liveFootballService && fixtureId) {
            try {
                // Récupérer le statut du match
                matchStatus = await liveFootballService.getMatchStatus(parseInt(fixtureId));
                
                // Essayer les cotes live d'abord
                const liveData = await liveFootballService.getFullLiveData(parseInt(fixtureId));
                
                // Parser les cotes live (format: bookmakers: { "Bet365": { "Home": 1.5, ... } })
                if (liveData?.odds && liveData.odds.length > 0) {
                    const firstOdds = liveData.odds[0];
                    const bookmakers = firstOdds?.bookmakers || {};
                    const firstBookmaker = Object.values(bookmakers)[0] || {};
                    
                    if (Object.keys(firstBookmaker).length > 0) {
                        oddsSource = "live";
                        console.log("📊 Using live odds from:", Object.keys(bookmakers)[0]);
                        
                        // Parser les valeurs
                        Object.entries(firstBookmaker).forEach(([key, value]) => {
                            const keyLower = key.toLowerCase();
                            
                            // Over/Under
                            if (keyLower.includes('over')) {
                                const line = keyLower.match(/[\d.]+/)?.[0] || '2.5';
                                liveOdds.goals = liveOdds.goals || {};
                                liveOdds.goals.over = liveOdds.goals.over || {};
                                liveOdds.goals.over[line] = parseFloat(value);
                            } else if (keyLower.includes('under')) {
                                const line = keyLower.match(/[\d.]+/)?.[0] || '2.5';
                                liveOdds.goals = liveOdds.goals || {};
                                liveOdds.goals.under = liveOdds.goals.under || {};
                                liveOdds.goals.under[line] = parseFloat(value);
                            }
                            // BTTS
                            else if (keyLower === 'yes' || keyLower === 'btts yes') {
                                liveOdds.bttsYes = parseFloat(value);
                            } else if (keyLower === 'no' || keyLower === 'btts no') {
                                liveOdds.bttsNo = parseFloat(value);
                            }
                            // 1X2
                            else if (keyLower === 'home') {
                                liveOdds.home = parseFloat(value);
                            } else if (keyLower === 'draw') {
                                liveOdds.draw = parseFloat(value);
                            } else if (keyLower === 'away') {
                                liveOdds.away = parseFloat(value);
                            }
                            // Double Chance
                            else if (keyLower === 'home/draw' || keyLower === '1x') {
                                liveOdds.doubleChance = liveOdds.doubleChance || {};
                                liveOdds.doubleChance['1X'] = parseFloat(value);
                            } else if (keyLower === 'draw/away' || keyLower === 'x2') {
                                liveOdds.doubleChance = liveOdds.doubleChance || {};
                                liveOdds.doubleChance['X2'] = parseFloat(value);
                            } else if (keyLower === 'home/away' || keyLower === '12') {
                                liveOdds.doubleChance = liveOdds.doubleChance || {};
                                liveOdds.doubleChance['12'] = parseFloat(value);
                            }
                        });
                    }
                }
                
                // Si pas de cotes live, essayer les cotes pré-match
                if (Object.keys(liveOdds).length === 0) {
                    console.log("⚠️ No live odds, trying pre-match odds...");
                    const preMatchOdds = await liveFootballService.getPreMatchOdds(parseInt(fixtureId));
                    
                    if (preMatchOdds) {
                        const bookmakerNames = Object.keys(preMatchOdds);
                        if (bookmakerNames.length > 0) {
                            const bm = preMatchOdds[bookmakerNames[0]];
                            oddsSource = "pre-match";
                            
                            // Goals Over/Under
                            if (bm['Goals Over/Under']) {
                                liveOdds.goals = { over: {}, under: {} };
                                Object.entries(bm['Goals Over/Under']).forEach(([key, val]) => {
                                    if (key.toLowerCase().includes('over')) {
                                        const line = key.match(/[\d.]+/)?.[0] || '2.5';
                                        liveOdds.goals.over[line] = parseFloat(val);
                                    } else if (key.toLowerCase().includes('under')) {
                                        const line = key.match(/[\d.]+/)?.[0] || '2.5';
                                        liveOdds.goals.under[line] = parseFloat(val);
                                    }
                                });
                            }
                            
                            // BTTS
                            if (bm['Both Teams Score']) {
                                liveOdds.bttsYes = parseFloat(bm['Both Teams Score']['Yes']) || 1.8;
                                liveOdds.bttsNo = parseFloat(bm['Both Teams Score']['No']) || 2.0;
                            }
                            
                            // 1X2
                            if (bm['Match Winner']) {
                                liveOdds.home = parseFloat(bm['Match Winner']['Home']) || 2.0;
                                liveOdds.draw = parseFloat(bm['Match Winner']['Draw']) || 3.5;
                                liveOdds.away = parseFloat(bm['Match Winner']['Away']) || 3.0;
                            }
                            
                            // Double Chance
                            if (bm['Double Chance']) {
                                liveOdds.doubleChance = {
                                    '1X': parseFloat(bm['Double Chance']['Home/Draw']) || 1.3,
                                    'X2': parseFloat(bm['Double Chance']['Draw/Away']) || 1.5,
                                    '12': parseFloat(bm['Double Chance']['Home/Away']) || 1.4
                                };
                            }
                        }
                    }
                }
                
                console.log(`📊 Odds retrieved (${oddsSource}):`, liveOdds);
                
            } catch (error) {
                console.warn("⚠️ Could not fetch odds:", error.message);
            }
        }
        
        // Si toujours pas de cotes, utiliser celles stockées dans la prédiction
        if (Object.keys(liveOdds).length === 0 && prediction.hedgingLiveData?.preMatchOdds) {
            const storedOdds = prediction.hedgingLiveData.preMatchOdds;
            const bookmakerNames = Object.keys(storedOdds);
            if (bookmakerNames.length > 0) {
                const bm = storedOdds[bookmakerNames[0]];
                oddsSource = "stored";
                
                // Parser les cotes stockées (même format que pré-match)
                if (bm['Goals Over/Under']) {
                    liveOdds.goals = { over: {}, under: {} };
                    Object.entries(bm['Goals Over/Under']).forEach(([key, val]) => {
                        if (key.toLowerCase().includes('over')) {
                            liveOdds.goals.over[key.match(/[\d.]+/)?.[0] || '2.5'] = parseFloat(val);
                        } else if (key.toLowerCase().includes('under')) {
                            liveOdds.goals.under[key.match(/[\d.]+/)?.[0] || '2.5'] = parseFloat(val);
                        }
                    });
                }
                if (bm['Both Teams Score']) {
                    liveOdds.bttsYes = parseFloat(bm['Both Teams Score']['Yes']) || 1.8;
                    liveOdds.bttsNo = parseFloat(bm['Both Teams Score']['No']) || 2.0;
                }
            }
            console.log(`📊 Using stored odds:`, liveOdds);
        }

        // ========== CALCULER LES MISES DE COUVERTURE ==========
        const breakEvenBets = [];
        const totalInvested = selectedOptions.reduce((sum, opt) => sum + (opt.stake || 0), 0);
        
        for (const opt of selectedOptions) {
            const stake = opt.stake || 0;
            const originalOdds = opt.odds || 1.5;
            const potentialReturn = stake * originalOdds;
            const optionLower = (opt.option || '').toLowerCase();
            
            let oppositeBet = null;
            let oppositeOdds = null;
            
            // Déterminer le pari opposé et sa cote
            if (optionLower.includes('plus de') || optionLower.includes('over')) {
                const goals = optionLower.match(/(\d+\.?\d*)/)?.[1] || '2.5';
                oppositeBet = `Moins de ${goals} buts`;
                oppositeOdds = liveOdds?.goals?.under?.[goals] || liveOdds?.goals?.under?.['2.5'] || 2.0;
            } 
            else if (optionLower.includes('moins de') || optionLower.includes('under')) {
                const goals = optionLower.match(/(\d+\.?\d*)/)?.[1] || '2.5';
                oppositeBet = `Plus de ${goals} buts`;
                oppositeOdds = liveOdds?.goals?.over?.[goals] || liveOdds?.goals?.over?.['2.5'] || 2.0;
            }
            else if (optionLower.includes('btts') && optionLower.includes('oui')) {
                oppositeBet = 'BTTS Non';
                oppositeOdds = liveOdds?.bttsNo || 1.8;
            }
            else if (optionLower.includes('btts') && optionLower.includes('non')) {
                oppositeBet = 'BTTS Oui';
                oppositeOdds = liveOdds?.bttsYes || 2.0;
            }
            else if (optionLower.includes('victoire') && (optionLower.includes('domicile') || optionLower.includes('1'))) {
                oppositeBet = 'Double Chance X2';
                oppositeOdds = liveOdds?.doubleChance?.['X2'] || 1.5;
            }
            else if (optionLower.includes('victoire') && (optionLower.includes('extérieur') || optionLower.includes('2'))) {
                oppositeBet = 'Double Chance 1X';
                oppositeOdds = liveOdds?.doubleChance?.['1X'] || 1.4;
            }
            else if (optionLower.includes('nul') || optionLower.includes('match nul')) {
                oppositeBet = 'Double Chance 12 (pas de nul)';
                oppositeOdds = liveOdds?.doubleChance?.['12'] || 1.3;
            }
            
            if (oppositeBet && oppositeOdds) {
                // Formule Break-Even: hedgeStake = potentialReturn / oppositeOdds
                const hedgeStake = Math.ceil(potentialReturn / oppositeOdds);
                const hedgeReturn = hedgeStake * oppositeOdds;
                
                // Scénarios
                const scenarioOriginalWins = potentialReturn - stake - hedgeStake;  // Pari original gagne
                const scenarioHedgeWins = hedgeReturn - stake - hedgeStake;         // Pari de couverture gagne
                
                breakEvenBets.push({
                    originalOption: opt.option,
                    originalStake: stake,
                    originalOdds: originalOdds,
                    potentialReturn: Math.round(potentialReturn),
                    oppositeBet,
                    oppositeOdds: Math.round(oppositeOdds * 100) / 100,
                    hedgeStake: Math.round(hedgeStake),
                    hedgeReturn: Math.round(hedgeReturn),
                    scenarios: {
                        originalWins: Math.round(scenarioOriginalWins),
                        hedgeWins: Math.round(scenarioHedgeWins),
                        difference: Math.abs(Math.round(scenarioOriginalWins - scenarioHedgeWins))
                    },
                    isBreakEven: Math.abs(scenarioOriginalWins - scenarioHedgeWins) < 50
                });
            } else {
                // Pas de couverture possible pour cette option
                breakEvenBets.push({
                    originalOption: opt.option,
                    originalStake: stake,
                    originalOdds: originalOdds,
                    potentialReturn: Math.round(potentialReturn),
                    oppositeBet: null,
                    error: "Cote opposée non disponible en live"
                });
            }
        }
        
        // Calculer le total
        const totalHedgeRequired = breakEvenBets.reduce((sum, b) => sum + (b.hedgeStake || 0), 0);
        const worstCaseWithHedge = Math.min(
            ...breakEvenBets.filter(b => b.scenarios).map(b => b.scenarios.hedgeWins)
        );
        const bestCaseWithHedge = Math.max(
            ...breakEvenBets.filter(b => b.scenarios).map(b => b.scenarios.originalWins)
        );
        
        // Log de l'action
        if (firestoreService) {
            try {
                await firestoreService.logUserAction(req.user.uid, 'calculate_break_even', {
                    predictionId,
                    totalInvested,
                    totalHedgeRequired,
                    betsCount: breakEvenBets.length
                }, { predictionId });
            } catch (logError) {
                console.warn("Could not log action:", logError.message);
            }
        }

        console.log(`✅ Break-even calculated for ${breakEvenBets.length} options`);
        
        res.json({
            success: true,
            breakEvenBets,
            summary: {
                totalInvested,
                totalHedgeRequired,
                totalAtRisk: totalInvested + totalHedgeRequired,
                worstCaseWithHedge: isFinite(worstCaseWithHedge) ? worstCaseWithHedge : 0,
                bestCaseWithHedge: isFinite(bestCaseWithHedge) ? bestCaseWithHedge : 0,
                liveOddsAvailable: Object.keys(liveOdds).length > 0,
                oddsSource: oddsSource
            },
            matchStatus: matchStatus ? {
                score: matchStatus.score,
                elapsed: matchStatus.elapsed,
                status: matchStatus.statusLong
            } : null,
            liveOdds
        });

    } catch (error) {
        console.error("❌ Error calculating break-even:", error);
        res.status(500).json({ 
            error: "Failed to calculate break-even", 
            details: error.message 
        });
    }
});

// ============== ROUTES - LIVE TRACKING ==============

/**
 * GET /api/live/:fixtureId/status
 * Récupère le statut du match pour vérifier si le hedging est possible
 */
app.get('/api/live/:fixtureId/status', authMiddleware, async (req, res) => {
    try {
        const { fixtureId } = req.params;

        if (!liveFootballService) {
            // Mode démo - simuler un statut mais indiquer clairement que c'est du démo
            return res.json({
                status: {
                    fixtureId: parseInt(fixtureId),
                    status: 'NS',
                    statusLong: 'Not Started',
                    elapsed: 0,
                    hasStarted: false,
                    isHalftimeOrLater: false,
                    isFinished: false,
                    canHedge: false,
                    score: { home: 0, away: 0 },
                    message: "⚠️ API-Football non configuré. Configurez API_FOOTBALL_KEY dans .env pour activer le suivi live."
                },
                isDemo: true
            });
        }

        const matchStatus = await liveFootballService.getMatchStatus(parseInt(fixtureId));
        
        if (!matchStatus) {
            return res.status(404).json({ 
                error: "Match not found",
                message: "Ce match n'a pas été trouvé dans l'API-Football. Vérifiez l'ID du match."
            });
        }

        // Ajouter un message explicatif basé sur le statut réel
        let message = "";
        if (!matchStatus.hasStarted) {
            message = "🔴 Le match n'a pas encore commencé. La stratégie de couverture sera disponible à partir de la mi-temps ou de la 40ème minute.";
        } else if (matchStatus.isFinished) {
            message = "⚫ Le match est terminé.";
        } else if (!matchStatus.canHedge) {
            const waitTime = Math.max(0, 40 - (matchStatus.elapsed || 0));
            message = `🟡 Match en cours (${matchStatus.elapsed}'). La stratégie de couverture sera disponible dans ~${waitTime} min.`;
        } else {
            message = "🟢 La stratégie de couverture est disponible!";
        }

        res.json({ 
            status: {
                ...matchStatus,
                message
            },
            isDemo: false
        });

    } catch (error) {
        console.error("Error fetching match status:", error);
        res.status(500).json({ error: "Failed to fetch match status", details: error.message });
    }
});

/**
 * GET /api/predictions/:id/track
 * Suit l'évolution d'une prédiction en temps réel
 */
app.get('/api/predictions/:id/track', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        // Récupérer la prédiction
        let prediction;
        if (firestoreService) {
            prediction = await firestoreService.getPredictionById(id);
            if (!prediction) {
                return res.status(404).json({ error: "Prediction not found" });
            }
        } else {
            return res.json({
                tracking: {
                    predictionId: id,
                    matchStatus: { status: 'NS', canHedge: false, hasStarted: false },
                    options: [],
                    message: "Mode démo - pas de suivi en temps réel"
                }
            });
        }

        // Récupérer le fixtureId (depuis plusieurs sources possibles)
        const fixtureId = prediction.matchInfo?.fixtureId || 
                         prediction.meta?.matchId ||
                         prediction.opportunityId;

        // Récupérer les options à évaluer (selectedOptions ou stakes.stakes)
        let optionsToEvaluate = prediction.selectedOptions || [];
        if (optionsToEvaluate.length === 0 && prediction.stakes?.stakes) {
            optionsToEvaluate = prediction.stakes.stakes;
        }
        if (optionsToEvaluate.length === 0 && prediction.oddsAnalysis?.recommendedOptions) {
            optionsToEvaluate = prediction.oddsAnalysis.recommendedOptions;
        }

        if (!fixtureId || !liveFootballService) {
            return res.json({
                tracking: {
                    predictionId: id,
                    matchStatus: { status: 'NS', canHedge: false, hasStarted: false },
                    options: optionsToEvaluate,
                    message: fixtureId ? "Service live non disponible (API_FOOTBALL_KEY non configuré)" : "ID du match non trouvé"
                }
            });
        }

        // Évaluer les options en temps réel
        const evaluation = await liveFootballService.evaluatePredictionOptions(
            parseInt(fixtureId),
            optionsToEvaluate
        );

        if (!evaluation) {
            return res.json({
                tracking: {
                    predictionId: id,
                    matchStatus: null,
                    options: optionsToEvaluate,
                    message: "Données live non disponibles - le match n'est peut-être pas encore dans l'API"
                }
            });
        }

        // Sauvegarder le statut live dans Firebase
        if (firestoreService) {
            await firestoreService.updatePredictionLiveStatus(id, {
                matchStatus: evaluation.matchStatus,
                evaluatedOptions: evaluation.options,
                lastUpdate: new Date().toISOString()
            });
        }

        res.json({
            tracking: {
                predictionId: id,
                matchStatus: evaluation.matchStatus,
                options: evaluation.options,
                canHedge: evaluation.canHedge,
                evaluatedAt: evaluation.evaluatedAt
            }
        });

    } catch (error) {
        console.error("Error tracking prediction:", error);
        res.status(500).json({ error: "Failed to track prediction", details: error.message });
    }
});

/**
 * POST /api/predictions/:id/finalize
 * Finalise une prédiction avec les résultats finaux et met à jour le capital
 */
app.post('/api/predictions/:id/finalize', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { results } = req.body; // Array of { status: 'won'|'lost', profit: number }

        if (!firestoreService) {
            return res.json({ 
                success: true, 
                result: { status: 'won', totalProfit: 500 },
                message: "Mode démo - résultat simulé"
            });
        }

        // Finaliser la prédiction et mettre à jour le capital
        const finalResult = await firestoreService.finalizePredictionWithResults(
            id,
            req.user.uid,
            results
        );

        // Log de l'action
        await firestoreService.logUserAction(req.user.uid, 'finalize_prediction', {
            predictionId: id,
            result: finalResult
        }, { predictionId: id });

        res.json({
            success: true,
            result: finalResult,
            message: finalResult.totalProfit >= 0 
                ? `Félicitations ! Profit: +${finalResult.totalProfit} FCFA`
                : `Perte: ${finalResult.totalProfit} FCFA`
        });

    } catch (error) {
        console.error("Error finalizing prediction:", error);
        res.status(500).json({ error: "Failed to finalize prediction", details: error.message });
    }
});

/**
 * GET /api/predictions/:id/live-status
 * Récupère le statut live d'un match pour le polling automatique
 */
app.get('/api/predictions/:id/live-status', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        if (!firestoreService) {
            return res.json({ 
                hasStarted: false, 
                isFinished: false, 
                canHedge: false,
                isDemo: true 
            });
        }

        const prediction = await firestoreService.getPredictionById(id);
        if (!prediction) {
            return res.status(404).json({ error: "Prediction not found" });
        }

        const fixtureId = prediction.matchInfo?.fixtureId || prediction.meta?.matchId;
        
        if (!fixtureId || !liveFootballService) {
            // Mode démo ou pas de service live
            const matchDate = new Date(prediction.matchInfo?.matchDate || prediction.matchInfo?.date);
            const now = new Date();
            const hasStarted = now >= matchDate;
            const elapsed = hasStarted ? Math.floor((now - matchDate) / 60000) : 0;
            
            return res.json({
                hasStarted,
                isFinished: elapsed >= 95,
                canHedge: elapsed >= 45 && elapsed < 95,
                elapsed,
                status: hasStarted ? (elapsed >= 95 ? 'FT' : 'LIVE') : 'NS',
                score: hasStarted ? { home: 0, away: 0 } : null,
                isDemo: true
            });
        }

        // Récupérer le statut réel via API-Football
        const matchStatus = await liveFootballService.getMatchStatus(parseInt(fixtureId));
        
        if (!matchStatus) {
            return res.json({ 
                hasStarted: false, 
                isFinished: false, 
                canHedge: false,
                error: 'Could not fetch match status'
            });
        }

        res.json({
            hasStarted: matchStatus.hasStarted,
            isFinished: matchStatus.isFinished,
            canHedge: matchStatus.canHedge,
            elapsed: matchStatus.elapsed,
            status: matchStatus.status,
            score: matchStatus.score,
            isDemo: matchStatus.isDemo || false
        });

    } catch (error) {
        console.error("Error fetching live status:", error);
        res.status(500).json({ error: "Failed to fetch live status", details: error.message });
    }
});

/**
 * POST /api/predictions/:id/auto-finalize
 * Finalise automatiquement une prédiction basée sur le score final
 */
app.post('/api/predictions/:id/auto-finalize', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        if (!firestoreService) {
            return res.json({ success: false, message: "Service non disponible" });
        }

        const prediction = await firestoreService.getPredictionById(id);
        if (!prediction) {
            return res.status(404).json({ error: "Prediction not found" });
        }

        const fixtureId = prediction.matchInfo?.fixtureId || prediction.meta?.matchId;
        
        if (!fixtureId || !liveFootballService) {
            return res.status(400).json({ error: "Cannot auto-finalize: no fixture ID or live service" });
        }

        // Vérifier que le match est terminé
        const matchStatus = await liveFootballService.getMatchStatus(parseInt(fixtureId));
        
        if (!matchStatus || !matchStatus.isFinished) {
            return res.status(400).json({ 
                error: "Le match n'est pas encore terminé",
                matchStatus: matchStatus?.status || 'unknown'
            });
        }

        // Évaluer les options avec le score final
        const evaluation = await liveFootballService.evaluatePredictionOptions(
            parseInt(fixtureId),
            prediction.selectedOptions || []
        );

        // Préparer les résultats avec calcul correct des profits
        const results = evaluation.options.map((opt, i) => {
            const originalOpt = prediction.selectedOptions?.[i] || opt;
            const stake = originalOpt.stake || originalOpt.adjustedStake || opt.stake || 0;
            const odds = originalOpt.odds || opt.odds || 1.5;
            
            // Déterminer le statut (won/lost)
            const status = opt.currentStatus === 'won' || opt.currentStatus === 'winning' ? 'won' : 'lost';
            
            // Calculer le profit
            let profit;
            if (status === 'won') {
                profit = Math.round(stake * odds - stake);  // Profit net = gain - mise
            } else {
                profit = -stake;  // Perte = -mise
            }
            
            console.log(`📊 Option "${opt.option}": status=${status}, stake=${stake}, odds=${odds}, profit=${profit}`);
            
            return { status, profit };
        });

        // Finaliser - IMPORTANT: cette fonction met déjà à jour le capital via updateUserBalance
        const finalResult = await firestoreService.finalizePredictionWithResults(
            id,
            req.user.uid,
            results
        );

        // ========== MISE À JOUR DU CAPITAL (SUPPLÉMENTAIRE) ==========
        // Note: finalizePredictionWithResults met déjà à jour le capital
        // Ici on ajoute juste à l'historique pour un meilleur suivi
        let totalProfitLoss = results.reduce((sum, r) => sum + (r.profit || 0), 0);

        // Récupérer le nouveau solde (déjà mis à jour par finalizePredictionWithResults)
        const user = await firestoreService.getUser(req.user.uid);
        const newBalance = user?.currentBalance || 0;
        const previousBalance = newBalance - totalProfitLoss;  // Calculer le solde précédent

        // Pas besoin de re-sauvegarder le solde (déjà fait dans finalizePredictionWithResults)
        // Juste mettre à jour le lastCapitalUpdate
        await firestoreService.upsertUser(req.user.uid, {
            lastCapitalUpdate: new Date().toISOString()
        });

        // Ajouter à l'historique du capital (en plus de ce que fait updateUserBalance)
        try {
            await firestoreService.db.collection('capitalHistory').add({
                userId: req.user.uid,
                change: totalProfitLoss,
                reason: totalProfitLoss >= 0 
                    ? `✅ Gains - ${prediction.matchInfo?.homeTeam || 'Match'} vs ${prediction.matchInfo?.awayTeam || ''}`
                    : `❌ Pertes - ${prediction.matchInfo?.homeTeam || 'Match'} vs ${prediction.matchInfo?.awayTeam || ''}`,
                predictionId: id,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                type: totalProfitLoss >= 0 ? 'win' : 'loss',
                previousBalance: previousBalance,
                newBalance: newBalance,
                details: {
                    matchScore: matchStatus.score,
                    optionsCount: results.length,
                    wonCount: results.filter(r => r.status === 'won').length,
                    lostCount: results.filter(r => r.status === 'lost').length
                }
            });
        } catch (historyError) {
            console.warn("Could not add capital history:", historyError.message);
        }

        console.log(`💰 Capital finalized: ${previousBalance} → ${newBalance} (${totalProfitLoss >= 0 ? '+' : ''}${totalProfitLoss} FCFA)`);
        // =============================================

        // Log
        await firestoreService.logUserAction(req.user.uid, 'auto_finalize_prediction', {
            predictionId: id,
            finalScore: matchStatus.score,
            result: finalResult,
            capitalChange: totalProfitLoss,
            newBalance: newBalance
        }, { predictionId: id });

        res.json({
            success: true,
            result: finalResult,
            finalScore: matchStatus.score,
            evaluatedOptions: evaluation.options,
            capitalUpdate: {
                previousBalance: previousBalance,
                change: totalProfitLoss,
                newBalance: newBalance
            }
        });

    } catch (error) {
        console.error("Error auto-finalizing prediction:", error);
        res.status(500).json({ error: "Failed to auto-finalize prediction", details: error.message });
    }
});

/**
 * POST /api/predictions/:id/recalculate
 * Recalcule les gains/pertes d'une prédiction déjà finalisée
 * Utile pour corriger les anciens matchs
 */
app.post('/api/predictions/:id/recalculate', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { manualResults } = req.body; // Optionnel: [{option: "Plus de 2.5", status: "won"}, ...]

        if (!firestoreService) {
            return res.status(400).json({ error: "Service non disponible" });
        }

        const prediction = await firestoreService.getPredictionById(id);
        if (!prediction) {
            return res.status(404).json({ error: "Prédiction non trouvée" });
        }

        // Vérifier que l'utilisateur est le propriétaire
        if (prediction.userId !== req.user.uid) {
            return res.status(403).json({ error: "Non autorisé" });
        }

        const options = prediction.selectedOptions || [];
        if (options.length === 0) {
            return res.status(400).json({ error: "Aucune option à recalculer" });
        }

        console.log(`🔄 Recalculating prediction ${id} with ${options.length} options`);

        // Recalculer chaque option
        let totalProfit = 0;
        let wonCount = 0;
        let lostCount = 0;
        
        const recalculatedOptions = options.map((opt, index) => {
            const stake = opt.stake || opt.adjustedStake || 0;
            const odds = opt.odds || 1.5;
            
            // Déterminer le statut: soit depuis manualResults, soit depuis opt.result existant
            let status = 'lost';  // Par défaut
            
            if (manualResults && manualResults[index]) {
                status = manualResults[index].status || 'lost';
            } else if (opt.result) {
                status = opt.result;
            } else if (opt.currentStatus) {
                status = opt.currentStatus === 'won' || opt.currentStatus === 'winning' ? 'won' : 'lost';
            }
            
            // Calculer le profit
            let profit;
            if (status === 'won') {
                profit = Math.round(stake * odds - stake);  // Profit net
                wonCount++;
                totalProfit += profit;
            } else {
                profit = -stake;
                lostCount++;
                totalProfit += profit;
            }
            
            console.log(`  Option "${opt.option}": stake=${stake}, odds=${odds}, status=${status}, profit=${profit}`);
            
            return {
                ...opt,
                result: status,
                profit: profit,
                recalculatedAt: new Date().toISOString()
            };
        });

        // Mettre à jour la prédiction
        const newStatus = totalProfit > 0 ? 'won' : totalProfit < 0 ? 'lost' : 'breakeven';
        
        await firestoreService.db.collection('predictions').doc(id).update({
            selectedOptions: recalculatedOptions,
            status: newStatus,
            finalResult: {
                totalProfit,
                wonCount,
                lostCount,
                recalculatedAt: new Date().toISOString()
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Mettre à jour le capital de l'utilisateur
        const user = await firestoreService.getUser(req.user.uid);
        const currentBalance = user?.currentBalance || 0;
        
        // Calculer la différence avec l'ancien profit (si existant)
        const oldProfit = prediction.finalResult?.totalProfit || 0;
        const profitDifference = totalProfit - oldProfit;
        
        if (profitDifference !== 0) {
            const newBalance = currentBalance + profitDifference;
            
            await firestoreService.upsertUser(req.user.uid, {
                currentBalance: newBalance,
                lastCapitalUpdate: new Date().toISOString()
            });

            // Ajouter à l'historique
            await firestoreService.db.collection('capitalHistory').add({
                userId: req.user.uid,
                change: profitDifference,
                reason: `🔄 Recalcul - ${prediction.matchInfo?.homeTeam || 'Match'} vs ${prediction.matchInfo?.awayTeam || ''}`,
                predictionId: id,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                type: 'recalculation',
                previousBalance: currentBalance,
                newBalance: newBalance,
                details: {
                    oldProfit,
                    newProfit: totalProfit,
                    wonCount,
                    lostCount
                }
            });

            console.log(`💰 Capital adjusted: ${currentBalance} → ${newBalance} (diff: ${profitDifference >= 0 ? '+' : ''}${profitDifference})`);
        }

        res.json({
            success: true,
            recalculated: {
                options: recalculatedOptions,
                totalProfit,
                wonCount,
                lostCount,
                status: newStatus
            },
            capitalUpdate: profitDifference !== 0 ? {
                previousBalance: currentBalance,
                change: profitDifference,
                newBalance: currentBalance + profitDifference
            } : null,
            message: `Prédiction recalculée: ${wonCount} gagnée(s), ${lostCount} perdue(s), profit total: ${totalProfit} FCFA`
        });

    } catch (error) {
        console.error("Error recalculating prediction:", error);
        res.status(500).json({ error: "Échec du recalcul", details: error.message });
    }
});

/**
 * POST /api/user/capital/recalculate-all
 * Recalcule TOUTES les prédictions finalisées et met à jour le capital
 */
app.post('/api/user/capital/recalculate-all', authMiddleware, async (req, res) => {
    try {
        if (!firestoreService) {
            return res.status(400).json({ error: "Service non disponible" });
        }

        // Récupérer toutes les prédictions de l'utilisateur
        const predictions = await firestoreService.getUserPredictions(req.user.uid);
        
        // Filtrer les prédictions finalisées
        const finalizedPredictions = predictions.filter(p => 
            p.status === 'won' || p.status === 'lost' || p.status === 'finished' || p.status === 'breakeven'
        );

        if (finalizedPredictions.length === 0) {
            return res.json({ 
                success: true, 
                message: "Aucune prédiction finalisée à recalculer",
                stats: { totalGains: 0, totalLosses: 0, netProfit: 0 }
            });
        }

        console.log(`🔄 Recalculating ${finalizedPredictions.length} predictions for user ${req.user.uid}`);

        let totalGains = 0;
        let totalLosses = 0;
        let wonBets = 0;
        let lostBets = 0;
        let recalculatedCount = 0;

        for (const pred of finalizedPredictions) {
            const options = pred.selectedOptions || [];
            let predProfit = 0;
            let predWon = 0;
            let predLost = 0;
            const recalculatedOptions = [];

            for (const opt of options) {
                const stake = opt.stake || opt.adjustedStake || 0;
                const odds = opt.odds || 1.5;
                
                // Déterminer le statut
                let status = 'lost';
                if (opt.result === 'won' || opt.currentStatus === 'won' || opt.currentStatus === 'winning') {
                    status = 'won';
                }
                
                // Calculer le profit
                let profit;
                if (status === 'won') {
                    profit = Math.round(stake * odds - stake);
                    totalGains += profit;
                    wonBets++;
                    predWon++;
                    predProfit += profit;
                } else {
                    profit = -stake;
                    totalLosses += stake;
                    lostBets++;
                    predLost++;
                    predProfit += profit;
                }

                recalculatedOptions.push({
                    ...opt,
                    result: status,
                    profit: profit
                });
            }

            // Mettre à jour la prédiction si les profits ont changé
            const oldProfit = pred.finalResult?.totalProfit || 0;
            if (Math.abs(predProfit - oldProfit) > 0.01 || !pred.finalResult) {
                const newStatus = predProfit > 0 ? 'won' : predProfit < 0 ? 'lost' : 'breakeven';
                
                await firestoreService.db.collection('predictions').doc(pred.id).update({
                    selectedOptions: recalculatedOptions,
                    status: newStatus,
                    finalResult: {
                        totalProfit: predProfit,
                        wonCount: predWon,
                        lostCount: predLost,
                        recalculatedAt: new Date().toISOString()
                    }
                });
                recalculatedCount++;
            }
        }

        // Calculer le nouveau solde
        const user = await firestoreService.getUser(req.user.uid);
        const initialBalance = user?.initialBalance || 50000;
        const netProfit = totalGains - totalLosses;
        const newBalance = initialBalance + netProfit;

        // Mettre à jour le solde
        await firestoreService.upsertUser(req.user.uid, {
            currentBalance: newBalance,
            lastCapitalUpdate: new Date().toISOString()
        });

        // Ajouter une entrée dans l'historique
        if (recalculatedCount > 0) {
            await firestoreService.db.collection('capitalHistory').add({
                userId: req.user.uid,
                change: netProfit,
                reason: `🔄 Recalcul global de ${recalculatedCount} prédiction(s)`,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                type: 'global_recalculation',
                details: {
                    predictionsCount: finalizedPredictions.length,
                    recalculatedCount,
                    totalGains,
                    totalLosses,
                    wonBets,
                    lostBets
                }
            });
        }

        console.log(`✅ Recalculation complete: ${recalculatedCount} updated, balance: ${newBalance}`);

        res.json({
            success: true,
            stats: {
                totalGains,
                totalLosses,
                netProfit,
                newBalance,
                wonBets,
                lostBets,
                winRate: wonBets + lostBets > 0 ? Math.round(wonBets / (wonBets + lostBets) * 100) : 0
            },
            recalculated: recalculatedCount,
            total: finalizedPredictions.length,
            message: `${recalculatedCount} prédiction(s) recalculée(s). Nouveau solde: ${newBalance.toLocaleString()} FCFA`
        });

    } catch (error) {
        console.error("Error recalculating all predictions:", error);
        res.status(500).json({ error: "Échec du recalcul global", details: error.message });
    }
});

// ============== ROUTES - NOTIFICATIONS ==============

/**
 * POST /api/notifications/subscribe
 * Enregistre un token de notification push
 */
app.post('/api/notifications/subscribe', authMiddleware, async (req, res) => {
    try {
        const { token, platform } = req.body; // platform: 'web', 'android', 'ios'

        if (!token) {
            return res.status(400).json({ error: "Token is required" });
        }

        if (firestoreService) {
            await firestoreService.upsertUser(req.user.uid, {
                notificationTokens: admin.firestore.FieldValue.arrayUnion({
                    token,
                    platform: platform || 'web',
                    createdAt: new Date().toISOString()
                })
            });
        }

        res.json({ success: true, message: "Notification subscription saved" });

    } catch (error) {
        console.error("Error subscribing to notifications:", error);
        res.status(500).json({ error: "Failed to subscribe to notifications" });
    }
});

/**
 * GET /api/notifications
 * Récupère les notifications de l'utilisateur
 */
app.get('/api/notifications', authMiddleware, async (req, res) => {
    try {
        const { limit = 20, unreadOnly = false } = req.query;

        if (!firestoreService) {
            return res.json({ notifications: [] });
        }

        let query = firestoreService.db.collection('notifications')
            .where('userId', '==', req.user.uid)
            .orderBy('createdAt', 'desc')
            .limit(parseInt(limit));

        if (unreadOnly === 'true') {
            query = query.where('read', '==', false);
        }

        const snapshot = await query.get();
        const notifications = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt
        }));

        res.json({ notifications });

    } catch (error) {
        console.error("Error fetching notifications:", error);
        // Fallback sans orderBy si index manquant
        try {
            const snapshot = await firestoreService.db.collection('notifications')
                .where('userId', '==', req.user.uid)
                .limit(20)
                .get();
            res.json({ 
                notifications: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
            });
        } catch {
            res.json({ notifications: [] });
        }
    }
});

/**
 * PUT /api/notifications/:id/read
 * Marque une notification comme lue
 */
app.put('/api/notifications/:id/read', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        if (firestoreService) {
            await firestoreService.db.collection('notifications').doc(id).update({
                read: true,
                readAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        res.json({ success: true });

    } catch (error) {
        console.error("Error marking notification as read:", error);
        res.status(500).json({ error: "Failed to mark notification as read" });
    }
});

/**
 * PUT /api/notifications/read-all
 * Marque toutes les notifications comme lues
 */
app.put('/api/notifications/read-all', authMiddleware, async (req, res) => {
    try {
        if (firestoreService) {
            const snapshot = await firestoreService.db.collection('notifications')
                .where('userId', '==', req.user.uid)
                .where('read', '==', false)
                .get();

            const batch = firestoreService.db.batch();
            snapshot.docs.forEach(doc => {
                batch.update(doc.ref, { 
                    read: true, 
                    readAt: admin.firestore.FieldValue.serverTimestamp() 
                });
            });
            await batch.commit();
        }

        res.json({ success: true });

    } catch (error) {
        console.error("Error marking all notifications as read:", error);
        res.status(500).json({ error: "Failed to mark notifications as read" });
    }
});

// ============== ROUTES - RECOMMENDATIONS ==============

/**
 * GET /api/user/recommendations
 * Récupère les recommandations existantes de l'utilisateur
 */
app.get('/api/user/recommendations', authMiddleware, async (req, res) => {
    try {
        if (!firestoreService) {
            // Mode démo avec recommandations génériques
            return res.json({ 
                recommendations: [{
                    id: 'demo_rec_1',
                    createdAt: new Date().toISOString(),
                    analysis: {
                        strengths: ["Utilisation intelligente de l'IA", "Bonne gestion du capital"],
                        weaknesses: ["Mise moyenne un peu élevée"],
                        riskProfile: "moderate",
                        trend: "positive"
                    },
                    recommendations: [
                        {
                            category: "strategy",
                            priority: "high",
                            title: "Continuez sur cette lancée",
                            description: "Votre taux de réussite est bon. Maintenez votre stratégie actuelle."
                        },
                        {
                            category: "bankroll",
                            priority: "medium", 
                            title: "Réduisez légèrement les mises",
                            description: "Considérez une mise à 4% du capital au lieu de 6% pour plus de sécurité."
                        }
                    ]
                }]
            });
        }

        const recommendations = await firestoreService.getUserRecommendations(req.user.uid, 10);
        res.json({ recommendations: recommendations || [] });

    } catch (error) {
        console.error("Error fetching recommendations:", error);
        res.status(500).json({ error: "Failed to fetch recommendations" });
    }
});

/**
 * POST /api/user/recommendations/generate
 * Génère de nouvelles recommandations personnalisées basées sur l'historique
 */
app.post('/api/user/recommendations/generate', authMiddleware, async (req, res) => {
    try {
        console.log("\n" + "━".repeat(50));
        console.log("🎯 Generating personalized recommendations...");
        console.log("━".repeat(50));

        // Récupérer les stats de l'utilisateur
        let userStats = {
            winRate: 50,
            totalBets: 0,
            wonBets: 0,
            lostBets: 0,
            totalGains: 0,
            totalLosses: 0,
            roi: 0,
            averageBet: 0,
            currentBalance: 50000,
            recentResults: []
        };

        if (firestoreService) {
            const predictions = await firestoreService.getUserPredictions(req.user.uid);
            const user = await firestoreService.getUser(req.user.uid);
            
            // Calculer les stats à partir des prédictions
            const finalized = predictions.filter(p => p.status === 'won' || p.status === 'lost');
            let totalGains = 0, totalLosses = 0, wonBets = 0, lostBets = 0, totalStaked = 0;
            const recentResults = [];
            
            for (const pred of finalized) {
                for (const opt of (pred.selectedOptions || [])) {
                    const stake = opt.stake || opt.adjustedStake || 0;
                    totalStaked += stake;
                    
                    if (opt.result === 'won' || pred.status === 'won') {
                        const profit = stake * (opt.odds || 1) - stake;
                        totalGains += profit;
                        wonBets++;
                        recentResults.push({ result: 'win', profit, option: opt.option });
                    } else {
                        totalLosses += stake;
                        lostBets++;
                        recentResults.push({ result: 'loss', loss: stake, option: opt.option });
                    }
                }
            }
            
            userStats = {
                winRate: (wonBets + lostBets) > 0 ? (wonBets / (wonBets + lostBets) * 100) : 50,
                totalBets: wonBets + lostBets,
                wonBets,
                lostBets,
                totalGains,
                totalLosses,
                roi: totalStaked > 0 ? ((totalGains - totalLosses) / totalStaked * 100) : 0,
                averageBet: (wonBets + lostBets) > 0 ? totalStaked / (wonBets + lostBets) : 0,
                currentBalance: user?.currentBalance || 50000,
                recentResults: recentResults.slice(-10)
            };
        }

        // Générer les recommandations - essayer d'abord avec l'IA
        let recommendations;
        
        // Vérifier si les API keys sont configurées
        const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
        const hasDeepseekKey = !!process.env.DEEPSEEK_API_KEY;
        
        console.log(`🔑 API Keys: Claude=${hasAnthropicKey ? 'OK' : 'MISSING'}, DeepSeek=${hasDeepseekKey ? 'OK' : 'MISSING'}`);
        console.log(`📊 User stats: ${userStats.totalBets} bets, ${userStats.winRate.toFixed(1)}% win rate`);
        
        if (hasAnthropicKey || hasDeepseekKey) {
            // Utiliser l'IA pour des recommandations personnalisées
            console.log("🧠 Using AI for personalized recommendations...");
            try {
                recommendations = await generateAIRecommendations(userStats);
                console.log(`✅ AI recommendations generated by: ${recommendations.generatedBy || 'unknown'}`);
            } catch (aiError) {
                console.warn("❌ AI recommendations failed:", aiError.message);
                console.log("📋 Falling back to rule-based recommendations");
                recommendations = generateSmartRecommendations(userStats);
            }
        } else {
            // Utiliser les recommandations basées sur les règles
            console.log("📋 Using rule-based recommendations (no API keys)");
            recommendations = generateSmartRecommendations(userStats);
        }

        // Sauvegarder si possible
        if (firestoreService) {
            try {
                await firestoreService.saveRecommendation(req.user.uid, recommendations);
                await firestoreService.logUserAction(req.user.uid, 'generate_recommendations', {
                    analysisDate: new Date().toISOString(),
                    stats: userStats
                });
            } catch (saveError) {
                console.warn("Could not save recommendations:", saveError.message);
            }
        }

        console.log("✅ Recommendations generated successfully!");

        res.json({ 
            recommendations,
            userStats: {
                winRate: userStats.winRate,
                totalBets: userStats.totalBets,
                roi: userStats.roi,
                currentBalance: userStats.currentBalance
            }
        });

    } catch (error) {
        console.error("Error generating recommendations:", error);
        res.status(500).json({ error: "Failed to generate recommendations", details: error.message });
    }
});

/**
 * Génère des recommandations avec l'IA (Claude ou DeepSeek)
 */
async function generateAIRecommendations(stats) {
    const prompt = `Tu es un expert en paris sportifs et gestion de bankroll. Analyse le profil de parieur suivant et donne des recommandations personnalisées et actionnables.

PROFIL DU PARIEUR:
- Capital actuel: ${stats.currentBalance?.toLocaleString() || '50000'} FCFA
- Nombre total de paris: ${stats.totalBets || 0}
- Paris gagnés: ${stats.wonBets || 0} (${(stats.winRate || 0).toFixed(1)}%)
- Paris perdus: ${stats.lostBets || 0}
- Gains totaux: ${(stats.totalGains || 0).toLocaleString()} FCFA
- Pertes totales: ${(stats.totalLosses || 0).toLocaleString()} FCFA
- ROI: ${(stats.roi || 0).toFixed(1)}%
- Mise moyenne: ${Math.round(stats.averageBet || 0).toLocaleString()} FCFA
${stats.recentResults?.length > 0 ? `- Résultats récents: ${stats.recentResults.slice(-5).map(r => r.result === 'win' ? '✅' : '❌').join(' ')}` : '- Aucun paris récent'}

INSTRUCTIONS:
Réponds UNIQUEMENT avec un objet JSON valide (sans markdown, sans backticks, sans texte avant ou après) avec cette structure exacte:
{
  "analysis": {
    "strengths": ["force 1", "force 2"],
    "weaknesses": ["faiblesse 1"],
    "riskProfile": "conservative",
    "trend": "stable"
  },
  "recommendations": [
    {
      "category": "strategy",
      "priority": "high",
      "title": "🎯 Titre",
      "description": "Description actionnable"
    }
  ],
  "motivationalMessage": "Message d'encouragement"
}

${stats.totalBets === 0 ? 'Cet utilisateur est nouveau, donne des conseils pour bien démarrer.' : 'Fournis 3-5 recommandations spécifiques basées sur ses données.'}`;

    // Essayer Claude en premier
    if (process.env.ANTHROPIC_API_KEY) {
        try {
            console.log("🤖 Calling Claude API...");
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': process.env.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-20250514',
                    max_tokens: 1500,
                    messages: [{ role: 'user', content: prompt }]
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Claude API error ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            const content = data.content[0]?.text || '';
            console.log("📝 Claude response received, length:", content.length);
            
            // Parser la réponse JSON
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    id: `rec_claude_${Date.now()}`,
                    createdAt: new Date().toISOString(),
                    generatedBy: 'claude',
                    ...parsed,
                    stats: {
                        winRate: stats.winRate || 0,
                        totalBets: stats.totalBets || 0,
                        roi: stats.roi || 0
                    }
                };
            } else {
                throw new Error('Could not parse Claude response as JSON');
            }
        } catch (claudeError) {
            console.warn("❌ Claude API failed:", claudeError.message);
        }
    }

    // Fallback vers DeepSeek
    if (process.env.DEEPSEEK_API_KEY) {
        try {
            console.log("🔮 Calling DeepSeek API...");
            const dsResponse = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 1500,
                    temperature: 0.7
                })
            });

            if (!dsResponse.ok) {
                const errorText = await dsResponse.text();
                throw new Error(`DeepSeek API error ${dsResponse.status}: ${errorText}`);
            }

            const dsData = await dsResponse.json();
            const dsContent = dsData.choices?.[0]?.message?.content || '';
            console.log("📝 DeepSeek response received, length:", dsContent.length);
            
            const jsonMatch = dsContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    id: `rec_deepseek_${Date.now()}`,
                    createdAt: new Date().toISOString(),
                    generatedBy: 'deepseek',
                    ...parsed,
                    stats: {
                        winRate: stats.winRate || 0,
                        totalBets: stats.totalBets || 0,
                        roi: stats.roi || 0
                    }
                };
            } else {
                throw new Error('Could not parse DeepSeek response as JSON');
            }
        } catch (dsError) {
            console.warn("❌ DeepSeek API failed:", dsError.message);
        }
    }

    // Si les deux échouent, lever une exception pour utiliser le fallback
    throw new Error('Both AI APIs failed');
}

/**
 * Génère des recommandations intelligentes basées sur les stats
 */
function generateSmartRecommendations(stats) {
    const recommendations = [];
    const analysis = {
        strengths: [],
        weaknesses: [],
        riskProfile: 'moderate',
        trend: 'stable'
    };

    // Analyser le taux de réussite
    if (stats.winRate >= 60) {
        analysis.strengths.push("Excellent taux de réussite");
        analysis.trend = 'positive';
        recommendations.push({
            category: "strategy",
            priority: "high",
            title: "🎯 Excellente performance !",
            description: `Votre taux de réussite de ${stats.winRate.toFixed(1)}% est remarquable. Continuez avec cette stratégie.`
        });
    } else if (stats.winRate >= 50) {
        analysis.strengths.push("Taux de réussite correct");
        recommendations.push({
            category: "strategy",
            priority: "medium",
            title: "📈 Bonne progression",
            description: `Taux de réussite de ${stats.winRate.toFixed(1)}%. Quelques ajustements peuvent améliorer vos résultats.`
        });
    } else if (stats.totalBets > 0) {
        analysis.weaknesses.push("Taux de réussite à améliorer");
        analysis.trend = 'negative';
        recommendations.push({
            category: "strategy",
            priority: "high",
            title: "⚠️ Réviser votre stratégie",
            description: `Taux de réussite de ${stats.winRate.toFixed(1)}%. Concentrez-vous sur les paris à faible risque.`
        });
    }

    // Analyser le ROI
    if (stats.roi > 10) {
        analysis.strengths.push("ROI positif excellent");
        recommendations.push({
            category: "bankroll",
            priority: "medium",
            title: "💰 ROI impressionnant",
            description: `ROI de ${stats.roi.toFixed(1)}%. Vous êtes rentable, maintenez votre discipline.`
        });
    } else if (stats.roi < 0 && stats.totalBets > 5) {
        analysis.weaknesses.push("ROI négatif");
        analysis.riskProfile = 'high';
        recommendations.push({
            category: "bankroll",
            priority: "high",
            title: "🔴 Attention au capital",
            description: `ROI de ${stats.roi.toFixed(1)}%. Réduisez vos mises et privilégiez la qualité à la quantité.`
        });
    }

    // Recommandations sur la gestion du capital
    if (stats.averageBet > stats.currentBalance * 0.1) {
        analysis.weaknesses.push("Mises trop élevées");
        analysis.riskProfile = 'aggressive';
        recommendations.push({
            category: "bankroll",
            priority: "high",
            title: "📊 Réduire les mises",
            description: `Mise moyenne de ${stats.averageBet.toLocaleString()} FCFA. Limitez-vous à 5-6% de votre capital par pari.`
        });
    }

    // Si peu de paris
    if (stats.totalBets < 5) {
        recommendations.push({
            category: "general",
            priority: "low",
            title: "📝 Accumulez plus de données",
            description: "Avec plus de paris, nos recommandations seront plus précises et personnalisées."
        });
    }

    // Recommandations générales
    recommendations.push({
        category: "strategy",
        priority: "medium",
        title: "🧠 Faites confiance à l'IA",
        description: "Nos analyses Claude + DeepSeek offrent une double vérification pour des prédictions plus fiables."
    });

    return {
        id: `rec_${Date.now()}`,
        createdAt: new Date().toISOString(),
        analysis,
        recommendations,
        stats: {
            winRate: stats.winRate,
            totalBets: stats.totalBets,
            roi: stats.roi
        }
    };
}

// ============== ROUTES - CAPITAL TRACKING ==============

/**
 * GET /api/user/capital/stats
 * Récupère les statistiques détaillées du capital
 */
app.get('/api/user/capital/stats', authMiddleware, async (req, res) => {
    try {
        if (!firestoreService) {
            return res.json({
                stats: {
                    currentBalance: 50000,
                    initialBalance: 50000,
                    totalGains: 15000,
                    totalLosses: 8000,
                    netProfit: 7000,
                    winRate: 62.5,
                    totalBets: 24,
                    wonBets: 15,
                    lostBets: 9,
                    roi: 14,
                    averageBet: 2000
                },
                history: [
                    { reason: 'Victoire PSG vs OM', change: 3500, timestamp: new Date().toISOString() },
                    { reason: 'Perte Lyon vs Monaco', change: -2000, timestamp: new Date(Date.now() - 86400000).toISOString() }
                ]
            });
        }

        // Récupérer toutes les prédictions finalisées de l'utilisateur
        const predictions = await firestoreService.getUserPredictions(req.user.uid);
        const user = await firestoreService.getUser(req.user.uid);
        
        // Filtrer les prédictions finalisées (won ou lost)
        const finalizedPredictions = predictions.filter(p => 
            p.status === 'won' || p.status === 'lost' || p.status === 'finished'
        );
        
        // Calculer les statistiques
        let totalGains = 0;
        let totalLosses = 0;
        let wonBets = 0;
        let lostBets = 0;
        let totalStaked = 0;
        const history = [];
        
        for (const pred of finalizedPredictions) {
            const options = pred.selectedOptions || [];
            
            for (const opt of options) {
                const stake = opt.stake || opt.adjustedStake || 0;
                totalStaked += stake;
                
                if (opt.result === 'won' || pred.status === 'won') {
                    const profit = opt.profit || (stake * (opt.odds || 1) - stake);
                    totalGains += profit;
                    wonBets++;
                    
                    history.push({
                        reason: `✅ ${opt.option} - ${pred.matchInfo?.homeTeam || 'Match'} vs ${pred.matchInfo?.awayTeam || ''}`,
                        change: profit,
                        timestamp: pred.finishedAt || pred.updatedAt || pred.createdAt,
                        type: 'win',
                        predictionId: pred.id
                    });
                } else if (opt.result === 'lost' || pred.status === 'lost') {
                    totalLosses += stake;
                    lostBets++;
                    
                    history.push({
                        reason: `❌ ${opt.option} - ${pred.matchInfo?.homeTeam || 'Match'} vs ${pred.matchInfo?.awayTeam || ''}`,
                        change: -stake,
                        timestamp: pred.finishedAt || pred.updatedAt || pred.createdAt,
                        type: 'loss',
                        predictionId: pred.id
                    });
                }
            }
        }
        
        // Récupérer aussi l'historique des ajustements manuels depuis capitalHistory (SANS orderBy)
        let capitalHistory = [];
        try {
            const historySnapshot = await firestoreService.db.collection('capitalHistory')
                .where('userId', '==', req.user.uid)
                .get();
            capitalHistory = historySnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    timestamp: data.timestamp?.toDate?.()?.toISOString() || data.timestamp || new Date().toISOString()
                };
            });
        } catch (historyError) {
            console.warn('Could not fetch capital history:', historyError.message);
            capitalHistory = [];
        }
        
        // Fusionner et trier l'historique CÔTÉ SERVEUR
        const allHistory = [...history, ...capitalHistory]
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 50);  // Limiter à 50 entrées
        
        // Récupérer le current_balance depuis userActions (details.userBalance)
        let balanceFromActions = null;
        try {
            const actionsSnapshot = await firestoreService.db.collection('userActions')
                .where('userId', '==', req.user.uid)
                .get();
            
            const actions = actionsSnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    action: data.action,
                    details: data.details,
                    timestamp: data.timestamp?.toDate?.()?.toISOString() || data.timestamp
                };
            });
            
            // Trier par timestamp décroissant
            actions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            // Chercher la première action avec details.userBalance
            for (const action of actions) {
                if (action.details?.userBalance !== undefined && action.details?.userBalance !== null) {
                    balanceFromActions = action.details.userBalance;
                    console.log(`💰 Found balance in details.userBalance: ${balanceFromActions} FCFA`);
                    break;
                }
            }
        } catch (actionsError) {
            console.warn('Could not fetch userActions for balance:', actionsError.message);
        }
        
        // Calculer les stats finales
        const totalBets = wonBets + lostBets;
        const netProfit = totalGains - totalLosses;
        const winRate = totalBets > 0 ? (wonBets / totalBets * 100) : 0;
        const roi = totalStaked > 0 ? (netProfit / totalStaked * 100) : 0;
        const averageBet = totalBets > 0 ? Math.round(totalStaked / totalBets) : 0;
        
        // Solde actuel - Priorité: userActions > user.currentBalance > calculé
        const initialBalance = user?.initialBalance || 50000;
        const currentBalance = balanceFromActions || user?.currentBalance || (initialBalance + netProfit);
        
        console.log(`📊 Stats: balance=${currentBalance}, source=${balanceFromActions ? 'userActions' : 'user doc'}`);

        res.json({
            stats: {
                currentBalance,
                initialBalance,
                totalGains: Math.round(totalGains),
                totalLosses: Math.round(totalLosses),
                netProfit: Math.round(netProfit),
                winRate: Math.round(winRate * 10) / 10,
                totalBets,
                wonBets,
                lostBets,
                roi: Math.round(roi * 10) / 10,
                averageBet,
                totalStaked: Math.round(totalStaked)
            },
            history: allHistory
        });

    } catch (error) {
        console.error("Error fetching capital stats:", error);
        res.status(500).json({ error: "Failed to fetch capital stats", details: error.message });
    }
});

/**
 * POST /api/user/capital/adjust
 * Ajuste manuellement le capital (dépôt, retrait, correction)
 */
app.post('/api/user/capital/adjust', authMiddleware, async (req, res) => {
    try {
        const { amount, reason, type } = req.body; // type: 'deposit', 'withdrawal', 'correction'

        if (!amount || !reason) {
            return res.status(400).json({ error: "Amount and reason are required" });
        }

        if (!firestoreService) {
            return res.json({ 
                success: true, 
                newBalance: 50000 + amount,
                message: "Mode démo - ajustement simulé"
            });
        }

        const user = await firestoreService.getUser(req.user.uid);
        
        // Récupérer le balance depuis userActions (details.userBalance)
        let balanceFromActions = null;
        try {
            const actionsSnapshot = await firestoreService.db.collection('userActions')
                .where('userId', '==', req.user.uid)
                .get();
            
            const actions = actionsSnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    action: data.action,
                    details: data.details,
                    timestamp: data.timestamp?.toDate?.()?.toISOString() || data.timestamp
                };
            });
            
            actions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            for (const action of actions) {
                if (action.details?.userBalance !== undefined && action.details?.userBalance !== null) {
                    balanceFromActions = action.details.userBalance;
                    break;
                }
            }
        } catch (err) {
            console.warn('Could not get balance from userActions:', err.message);
        }
        
        const currentBalance = balanceFromActions || user?.currentBalance || 50000;
        const newBalance = currentBalance + amount;

        if (newBalance < 0) {
            return res.status(400).json({ error: "Le solde ne peut pas être négatif" });
        }

        const result = await firestoreService.updateUserBalance(
            req.user.uid,
            newBalance,
            `${type || 'manual'}_${reason}`,
            null
        );

        // Log de l'action
        await firestoreService.logUserAction(req.user.uid, 'capital_adjustment', {
            amount,
            reason,
            type,
            previousBalance: currentBalance,
            newBalance: newBalance
        });

        res.json({
            success: true,
            previousBalance: currentBalance,
            newBalance: newBalance,
            change: amount
        });

    } catch (error) {
        console.error("Error adjusting capital:", error);
        res.status(500).json({ error: "Failed to adjust capital" });
    }
});

// ============== ROUTES - BALANCE ENTRIES (Nouveau système de suivi du capital) ==============

/**
 * POST /api/balance-entries/add
 * Ajoute une nouvelle entrée de solde avec motif
 */
app.post('/api/balance-entries/add', authMiddleware, async (req, res) => {
    try {
        const { newBalance, motif, description } = req.body;

        if (!newBalance || !motif) {
            return res.status(400).json({ error: "newBalance et motif sont requis" });
        }

        // Valider le motif
        const validMotifs = ['Dépôt', 'Retrait', 'Bénéfice', 'Perte'];
        if (!validMotifs.includes(motif)) {
            return res.status(400).json({ error: "Motif invalide. Utilisez: Dépôt, Retrait, Bénéfice ou Perte" });
        }

        // Valider que le montant est positif
        if (newBalance < 0) {
            return res.status(400).json({ error: "Le solde ne peut pas être négatif" });
        }

        if (!firestoreService) {
            return res.json({
                success: true,
                entry: {
                    id: 'demo_' + Date.now(),
                    oldBalance: 50000,
                    newBalance: parseFloat(newBalance),
                    difference: parseFloat(newBalance) - 50000,
                    motif,
                    description: description || '',
                    timestamp: new Date()
                },
                message: "Mode démo - entrée simulée"
            });
        }

        // Ajouter l'entrée
        const entry = await firestoreService.addBalanceEntry(
            req.user.uid,
            parseFloat(newBalance),
            motif,
            description || ''
        );

        // Log de l'action
        await firestoreService.logUserAction(req.user.uid, 'balance_entry_added', {
            newBalance: parseFloat(newBalance),
            motif,
            difference: entry.difference
        });

        console.log(`✅ Balance entry added for user ${req.user.uid}: ${entry.oldBalance} → ${entry.newBalance} (${motif})`);

        res.json({
            success: true,
            entry: {
                id: entry.id,
                oldBalance: entry.oldBalance,
                newBalance: entry.newBalance,
                difference: entry.difference,
                motif: entry.motif,
                description: entry.description,
                timestamp: entry.timestamp
            }
        });

    } catch (error) {
        console.error("Error adding balance entry:", error);
        res.status(500).json({ error: "Erreur lors de l'ajout de l'entrée" });
    }
});

/**
 * GET /api/balance-entries/history
 * Récupère l'historique des entrées de solde
 */
app.get('/api/balance-entries/history', authMiddleware, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;

        if (!firestoreService) {
            // Mode démo
            return res.json({
                entries: [
                    {
                        id: 'demo_1',
                        oldBalance: 40000,
                        newBalance: 50000,
                        difference: 10000,
                        motif: 'Dépôt',
                        description: 'Dépôt initial',
                        timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
                    },
                    {
                        id: 'demo_2',
                        oldBalance: 50000,
                        newBalance: 52000,
                        difference: 2000,
                        motif: 'Bénéfice',
                        description: 'Gain sur pari',
                        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
                    },
                    {
                        id: 'demo_3',
                        oldBalance: 52000,
                        newBalance: 51000,
                        difference: -1000,
                        motif: 'Perte',
                        description: 'Perte sur pari',
                        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
                    }
                ]
            });
        }

        const entries = await firestoreService.getBalanceHistory(req.user.uid, limit);

        res.json({ entries });

    } catch (error) {
        console.error("Error getting balance history:", error);
        res.status(500).json({ error: "Erreur lors de la récupération de l'historique" });
    }
});

/**
 * GET /api/balance-entries/stats
 * Récupère les statistiques du capital
 */
app.get('/api/balance-entries/stats', authMiddleware, async (req, res) => {
    try {
        if (!firestoreService) {
            // Mode démo
            return res.json({
                stats: {
                    currentBalance: 51000,
                    totalGains: 2000,
                    totalLosses: 1000,
                    netProfit: 1000,
                    totalDeposits: 10000,
                    totalWithdrawals: 0,
                    entriesCount: 3
                }
            });
        }

        const stats = await firestoreService.getCapitalStats(req.user.uid);

        res.json({ stats });

    } catch (error) {
        console.error("Error getting capital stats:", error);
        res.status(500).json({ error: "Erreur lors de la récupération des statistiques" });
    }
});

/**
 * GET /api/balance-entries/last
 * Récupère le dernier solde enregistré
 */
app.get('/api/balance-entries/last', authMiddleware, async (req, res) => {
    try {
        if (!firestoreService) {
            // Mode démo
            return res.json({
                lastBalance: {
                    id: 'demo_last',
                    balance: 51000,
                    newBalance: 51000,
                    motif: 'Perte',
                    timestamp: new Date()
                }
            });
        }

        const lastEntry = await firestoreService.getLastBalance(req.user.uid);

        if (!lastEntry) {
            return res.json({
                lastBalance: null,
                message: "Aucune entrée trouvée. Ajoutez votre premier solde."
            });
        }

        res.json({
            lastBalance: {
                id: lastEntry.id,
                balance: lastEntry.newBalance,
                newBalance: lastEntry.newBalance,
                motif: lastEntry.motif,
                timestamp: lastEntry.timestamp
            }
        });

    } catch (error) {
        console.error("Error getting last balance:", error);
        res.status(500).json({ error: "Erreur lors de la récupération du dernier solde" });
    }
});

/**
 * POST /api/capital/recommendations
 * Génère des recommandations personnalisées basées sur l'historique du capital
 */
app.post('/api/capital/recommendations', authMiddleware, async (req, res) => {
    try {
        const { stats, history } = req.body;

        if (!stats) {
            return res.status(400).json({ error: "Stats are required" });
        }

        // Préparer le prompt pour DeepSeek
        const prompt = `Tu es un expert en gestion de bankroll pour les paris sportifs. Analyse les données suivantes et donne des recommandations personnalisées.

## STATISTIQUES DU CAPITAL
- Solde actuel: ${stats.currentBalance || 0} FCFA
- Gains totaux: ${stats.totalGains || 0} FCFA
- Pertes totales: ${stats.totalLosses || 0} FCFA
- Profit net: ${stats.netProfit || 0} FCFA
- Total des dépôts: ${stats.totalDeposits || 0} FCFA
- Total des retraits: ${stats.totalWithdrawals || 0} FCFA
- Nombre d'entrées: ${stats.entriesCount || 0}

## HISTORIQUE RÉCENT (${history?.length || 0} dernières entrées)
${history?.slice(0, 10).map((h, i) => `${i+1}. ${h.motif}: ${h.difference >= 0 ? '+' : ''}${h.difference} FCFA (${new Date(h.timestamp).toLocaleDateString('fr-FR')})`).join('\n') || 'Aucun historique'}

## INSTRUCTIONS
1. Analyse la santé financière du capital
2. Identifie les patterns (gains/pertes fréquents, tendances)
3. Donne 3-5 recommandations concrètes et actionnables
4. Calcule la mise maximale recommandée (5% du capital)
5. Évalue le niveau de risque (low, medium, high)

Réponds en JSON:
{
    "analysis": "Ton analyse détaillée en français avec des emojis...",
    "riskLevel": "low|medium|high",
    "suggestedMaxBet": number,
    "tips": ["conseil1", "conseil2", "conseil3"]
}`;

        // Essayer d'utiliser DeepSeek
        if (predictionService && predictionService.deepseekKey) {
            try {
                console.log("🧠 Generating capital recommendations with DeepSeek...");
                
                const result = await callDeepSeek(
                    prompt,
                    predictionService.deepseekKey,
                    "Tu es un expert en gestion de bankroll et paris sportifs. Tu donnes des conseils précis et personnalisés.",
                    true
                );
                
                console.log("✅ DeepSeek recommendations generated");
                
                // Log de l'action
                if (firestoreService) {
                    await firestoreService.logUserAction(req.user.uid, 'capital_recommendations', {
                        currentBalance: stats.currentBalance,
                        netProfit: stats.netProfit
                    });
                }
                
                return res.json({ recommendations: result });
                
            } catch (deepseekError) {
                console.warn("⚠️ DeepSeek error:", deepseekError.message);
            }
        }

        // Fallback - Recommandations calculées localement
        const currentBalance = stats.currentBalance || 0;
        const netProfit = stats.netProfit || 0;
        const winRate = stats.totalGains > 0 && stats.totalLosses > 0 
            ? (stats.totalGains / (stats.totalGains + stats.totalLosses)) * 100 
            : 50;
        
        let riskLevel = 'medium';
        let analysis = '';
        
        if (netProfit > 0 && winRate > 55) {
            riskLevel = 'low';
            analysis = `📊 **Excellente gestion du capital!**\n\nVotre solde actuel de ${currentBalance.toLocaleString()} FCFA montre une progression positive avec un profit net de +${netProfit.toLocaleString()} FCFA.\n\n✅ **Points forts:**\n- Taux de réussite estimé: ~${winRate.toFixed(0)}%\n- Bonne discipline de mise\n- Capital en croissance\n\n💡 **Recommandations:**\n- Continuez avec votre stratégie actuelle\n- Mise max recommandée: ${Math.round(currentBalance * 0.05).toLocaleString()} FCFA (5%)\n- Pensez à sécuriser une partie de vos gains par un retrait`;
        } else if (netProfit < 0) {
            riskLevel = 'high';
            analysis = `⚠️ **Attention - Capital en baisse**\n\nVotre solde de ${currentBalance.toLocaleString()} FCFA montre une perte nette de ${netProfit.toLocaleString()} FCFA.\n\n🔴 **Points d'attention:**\n- Pertes supérieures aux gains\n- Risque de diminution du capital\n\n💡 **Recommandations urgentes:**\n- Réduisez vos mises à 2-3% du capital\n- Mise max: ${Math.round(currentBalance * 0.03).toLocaleString()} FCFA\n- Évitez de "chasser" vos pertes\n- Faites une pause si nécessaire\n- Analysez vos paris perdants pour identifier les erreurs`;
        } else {
            analysis = `📊 **Analyse de votre capital**\n\nVotre solde actuel est de ${currentBalance.toLocaleString()} FCFA avec un profit net de ${netProfit.toLocaleString()} FCFA.\n\n📈 **Situation:**\n- Capital stable\n- Marge de progression possible\n\n💡 **Recommandations:**\n- Mise max recommandée: ${Math.round(currentBalance * 0.05).toLocaleString()} FCFA (5%)\n- Diversifiez vos paris\n- Tenez un journal de vos paris\n- Fixez-vous des objectifs réalistes`;
        }
        
        const recommendations = {
            analysis,
            riskLevel,
            suggestedMaxBet: Math.round(currentBalance * (riskLevel === 'high' ? 0.03 : 0.05)),
            tips: [
                "Ne misez jamais plus de 5% de votre capital sur un seul pari",
                "Évitez les paris émotionnels après une perte",
                "Tenez un historique détaillé de tous vos paris",
                "Fixez-vous un objectif de profit quotidien/hebdomadaire",
                "Faites des pauses régulières pour garder la tête froide"
            ]
        };

        res.json({ recommendations });

    } catch (error) {
        console.error("Error generating recommendations:", error);
        res.status(500).json({ error: "Erreur lors de la génération des recommandations" });
    }
});

// ============== ROUTES - USER ==============

/**
 * GET /api/user/profile
 * Récupère le profil utilisateur
 */
app.get('/api/user/profile', authMiddleware, async (req, res) => {
    try {
        if (firestoreService) {
            let user = await firestoreService.getUser(req.user.uid);
            
            // Créer le profil si inexistant
            if (!user) {
                user = await firestoreService.upsertUser(req.user.uid, {
                    email: req.user.email,
                    displayName: req.user.displayName
                });
            }

            res.json({ user });
        } else {
            res.json({
                user: {
                    id: req.user.uid,
                    email: req.user.email,
                    displayName: req.user.displayName,
                    currentBalance: 50000,
                    settings: { minBet: 90, maxBetPercentage: 6 }
                }
            });
        }
    } catch (error) {
        console.error("Error fetching user profile:", error);
        res.status(500).json({ error: "Failed to fetch user profile" });
    }
});

/**
 * PUT /api/user/profile
 * Met à jour le profil utilisateur
 */
app.put('/api/user/profile', authMiddleware, async (req, res) => {
    try {
        const { displayName, bookmaker, settings } = req.body;

        if (firestoreService) {
            const updateData = {};
            if (displayName) updateData.displayName = displayName;
            if (bookmaker) updateData.bookmaker = bookmaker;
            if (settings) updateData.settings = settings;

            await firestoreService.upsertUser(req.user.uid, updateData);
            const user = await firestoreService.getUser(req.user.uid);
            res.json({ user });
        } else {
            res.json({ user: { ...req.body, id: req.user.uid } });
        }
    } catch (error) {
        console.error("Error updating user profile:", error);
        res.status(500).json({ error: "Failed to update user profile" });
    }
});

/**
 * POST /api/user/balance
 * Met à jour le solde utilisateur
 */
app.post('/api/user/balance', authMiddleware, async (req, res) => {
    try {
        const { newBalance, reason, predictionId } = req.body;

        if (typeof newBalance !== 'number') {
            return res.status(400).json({ error: "newBalance must be a number" });
        }

        if (firestoreService) {
            const result = await firestoreService.updateUserBalance(
                req.user.uid,
                newBalance,
                reason || 'manual_update',
                predictionId
            );

            // Log de l'action
            await firestoreService.logUserAction(req.user.uid, 'update_balance', {
                ...result,
                reason
            }, { predictionId });

            res.json({ success: true, ...result });
        } else {
            res.json({ success: true, previousBalance: 0, newBalance, change: newBalance });
        }
    } catch (error) {
        console.error("Error updating balance:", error);
        res.status(500).json({ error: "Failed to update balance" });
    }
});

/**
 * GET /api/user/capital
 * Récupère l'historique et les stats du capital
 */
app.get('/api/user/capital', authMiddleware, async (req, res) => {
    try {
        console.log(`📊 Fetching capital for user ${req.user.uid}`);
        
        if (firestoreService) {
            // Récupérer l'utilisateur directement
            const user = await firestoreService.getUser(req.user.uid);
            
            // Récupérer le current_balance depuis userActions (dans details.userBalance)
            let balanceFromActions = null;
            try {
                const actionsSnapshot = await firestoreService.db.collection('userActions')
                    .where('userId', '==', req.user.uid)
                    .get();
                
                console.log(`📋 Found ${actionsSnapshot.docs.length} userActions`);
                
                const actions = actionsSnapshot.docs.map(doc => {
                    const data = doc.data();
                    return {
                        id: doc.id,
                        action: data.action,
                        details: data.details,
                        timestamp: data.timestamp?.toDate?.()?.toISOString() || data.timestamp
                    };
                });
                
                // Trier par timestamp décroissant (plus récent en premier)
                actions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                
                // Chercher la première action avec details.userBalance
                for (const action of actions) {
                    if (action.details?.userBalance !== undefined && action.details?.userBalance !== null) {
                        balanceFromActions = action.details.userBalance;
                        console.log(`💰 Found balance in details.userBalance (${action.action}): ${balanceFromActions} FCFA`);
                        break;
                    }
                }
                
                if (balanceFromActions === null) {
                    console.log(`⚠️ No balance found in userActions.details.userBalance`);
                }
            } catch (actionsError) {
                console.warn('❌ Could not fetch userActions:', actionsError.message);
            }
            
            // Récupérer l'historique depuis capitalHistory SANS orderBy (éviter l'erreur d'index)
            let history = [];
            try {
                const historySnapshot = await firestoreService.db.collection('capitalHistory')
                    .where('userId', '==', req.user.uid)
                    .get();
                    
                history = historySnapshot.docs.map(doc => {
                    const data = doc.data();
                    return {
                        id: doc.id,
                        ...data,
                        timestamp: data.timestamp?.toDate?.()?.toISOString() || data.timestamp || new Date().toISOString()
                    };
                });
                
                // Trier côté serveur (plus récent en premier)
                history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                
                // Limiter à 50 entrées
                history = history.slice(0, 50);
                
                console.log(`📜 Found ${history.length} capital history entries`);
            } catch (historyError) {
                console.warn('Could not fetch capital history:', historyError.message);
                history = [];
            }
            
            // Priorité: userActions > user.currentBalance > 50000
            const currentBalance = balanceFromActions || user?.currentBalance || 50000;
            const initialBalance = user?.initialBalance || 50000;
            
            console.log(`✅ User capital: ${currentBalance} FCFA (initial: ${initialBalance}, source: ${balanceFromActions ? 'userActions' : 'user doc'})`);

            res.json({ 
                capital: {
                    currentBalance,
                    initialBalance
                },
                history,
                stats: {
                    currentBalance,
                    initialBalance
                }
            });
        } else {
            // Mode démo
            res.json({
                capital: {
                    currentBalance: 50000,
                    initialBalance: 50000
                },
                history: [],
                stats: {
                    currentBalance: 50000,
                    initialBalance: 50000
                }
            });
        }
    } catch (error) {
        console.error("Error fetching capital data:", error);
        res.status(500).json({ error: "Failed to fetch capital data", details: error.message });
    }
});

/**
 * GET /api/user/actions
 * Récupère l'historique des actions utilisateur
 */
app.get('/api/user/actions', authMiddleware, async (req, res) => {
    try {
        const { limit } = req.query;

        if (firestoreService) {
            const actions = await firestoreService.getUserActions(req.user.uid, parseInt(limit) || 50);
            res.json({ actions });
        } else {
            res.json({ actions: [] });
        }
    } catch (error) {
        console.error("Error fetching user actions:", error);
        res.status(500).json({ error: "Failed to fetch user actions" });
    }
});

// ============== ROUTES - FORMATIONS ==============

/**
 * GET /api/formations
 * Récupère les formations (public)
 */
app.get('/api/formations', async (req, res) => {
    try {
        if (firestoreService) {
            const formations = await firestoreService.getFormations();
            res.json({ formations });
        } else {
            res.json({
                formations: [{
                    id: "formation_1",
                    title: "Deviens un parieur pro",
                    description: "Les fondamentaux des paris sportifs",
                    chapters: [
                        { id: "ch1", title: "Les bases", duration: "15 min" },
                        { id: "ch2", title: "Gestion de bankroll", duration: "20 min" }
                    ]
                }]
            });
        }
    } catch (error) {
        console.error("Error fetching formations:", error);
        res.status(500).json({ error: "Failed to fetch formations" });
    }
});

/**
 * GET /api/formations/:id
 * Récupère une formation (auth requise)
 */
app.get('/api/formations/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        // Log de l'action
        if (firestoreService) {
            await firestoreService.logUserAction(req.user.uid, 'view_formation', {
                formationId: id
            });

            const formation = await firestoreService.getFormationById(id);
            if (!formation) {
                return res.status(404).json({ error: "Formation not found" });
            }
            res.json({ formation });
        } else {
            res.json({
                formation: {
                    id,
                    title: "Deviens un parieur pro",
                    chapters: [{
                        title: "Les bases",
                        videoUrl: "https://example.com/video.mp4",
                        content: "Contenu du chapitre..."
                    }]
                }
            });
        }
    } catch (error) {
        console.error("Error fetching formation:", error);
        res.status(500).json({ error: "Failed to fetch formation" });
    }
});

// ============== ROUTES - HEALTH & STATUS ==============

/**
 * GET /api/health
 */
app.get('/api/health', async (req, res) => {
    const status = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
            firebase: isFirebaseInitialized ? 'connected' : 'mock mode',
            predictionAI: {
                status: predictionService ? 'ready' : 'disabled',
                engines: predictionService ? {
                    claude: process.env.ANTHROPIC_API_KEY ? 'configured' : 'not configured',
                    deepseek: process.env.DEEPSEEK_API_KEY ? 'configured' : 'not configured'
                } : null
            },
            liveFootball: liveFootballService ? 'ready' : 'disabled'
        },
        bookmakers: {
            popular: POPULAR_BOOKMAKERS_AFRICA.length,
            total: API_FOOTBALL_BOOKMAKERS.length
        }
    };

    // Vérifier la connexion API-Football si disponible
    if (liveFootballService) {
        try {
            const isConnected = await liveFootballService.checkConnection();
            status.services.liveFootball = isConnected ? 'connected' : 'error';
        } catch {
            status.services.liveFootball = 'error';
        }
    }

    res.json(status);
});

/**
 * GET /api/status
 * Informations détaillées sur l'API
 */
app.get('/api/status', async (req, res) => {
    res.json({
        version: '3.0.0',
        name: 'E-Cauri API',
        description: 'Sports Betting Predictions with AI Thinking',
        environment: process.env.NODE_ENV || 'development',
        features: {
            opportunities: true,
            predictions: !!predictionService,
            liveData: !!liveFootballService,
            formations: true,
            capitalTracking: true,
            bookmakerSelection: true
        },
        aiEngines: {
            primary: {
                name: 'Claude',
                model: 'claude-sonnet-4-20250514',
                feature: 'Extended Thinking',
                status: process.env.ANTHROPIC_API_KEY ? 'ready' : 'not configured'
            },
            secondary: {
                name: 'DeepSeek',
                model: 'deepseek-reasoner',
                feature: 'Reasoning Mode',
                status: process.env.DEEPSEEK_API_KEY ? 'ready' : 'not configured'
            }
        }
    });
});

// ============== ERROR HANDLING ==============

// ============== ROUTES - ADMIN ==============

/**
 * Middleware pour vérifier si l'utilisateur est admin
 */
const adminMiddleware = async (req, res, next) => {
    try {
        // Vérifier d'abord l'authentification
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Token required' });
        }

        const token = authHeader.split(' ')[1];
        
        // Vérifier avec Firebase Admin
        if (admin.apps.length > 0) {
            const decoded = await admin.auth().verifyIdToken(token);
            req.user = decoded;
            
            // Vérifier si l'utilisateur a le rôle admin
            if (firestoreService) {
                const user = await firestoreService.getUser(decoded.uid);
                if (!user?.isAdmin) {
                    return res.status(403).json({ error: 'Admin access required' });
                }
            }
            
            next();
        } else {
            return res.status(401).json({ error: 'Auth not available' });
        }
    } catch (error) {
        console.error('Admin auth error:', error);
        res.status(401).json({ error: 'Invalid token or not admin' });
    }
};

/**
 * POST /api/admin/users/create
 * Crée un nouvel utilisateur (admin uniquement)
 */
app.post('/api/admin/users/create', adminMiddleware, async (req, res) => {
    try {
        const { email, password, displayName, initialBalance, isAdmin } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required" });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: "Password must be at least 6 characters" });
        }

        // Créer l'utilisateur dans Firebase Auth
        const userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: displayName || email.split('@')[0],
            emailVerified: true
        });

        console.log(`👤 User created: ${userRecord.uid} (${email})`);

        // Créer le profil dans Firestore
        if (firestoreService) {
            await firestoreService.upsertUser(userRecord.uid, {
                email,
                displayName: displayName || email.split('@')[0],
                currentBalance: initialBalance || 50000,
                initialBalance: initialBalance || 50000,
                isAdmin: isAdmin || false,
                createdAt: new Date().toISOString(),
                createdBy: req.user.uid
            });
        }

        res.json({
            success: true,
            user: {
                uid: userRecord.uid,
                email: userRecord.email,
                displayName: userRecord.displayName,
                initialBalance: initialBalance || 50000
            }
        });

    } catch (error) {
        console.error("Error creating user:", error);
        
        // Messages d'erreur Firebase spécifiques
        if (error.code === 'auth/email-already-exists') {
            return res.status(400).json({ error: "Un compte avec cet email existe déjà" });
        }
        if (error.code === 'auth/invalid-email') {
            return res.status(400).json({ error: "Email invalide" });
        }
        if (error.code === 'auth/weak-password') {
            return res.status(400).json({ error: "Mot de passe trop faible" });
        }
        
        res.status(500).json({ error: "Failed to create user", details: error.message });
    }
});

/**
 * GET /api/admin/users
 * Liste tous les utilisateurs (admin uniquement)
 */
app.get('/api/admin/users', adminMiddleware, async (req, res) => {
    try {
        if (!firestoreService) {
            return res.json({ users: [] });
        }

        const usersSnapshot = await firestoreService.db.collection('users').get();
        const users = usersSnapshot.docs.map(doc => ({
            uid: doc.id,
            ...doc.data(),
            // Ne pas exposer les données sensibles
            password: undefined
        }));

        res.json({ users });

    } catch (error) {
        console.error("Error listing users:", error);
        res.status(500).json({ error: "Failed to list users" });
    }
});

/**
 * PUT /api/admin/users/:uid
 * Modifie un utilisateur (admin uniquement)
 */
app.put('/api/admin/users/:uid', adminMiddleware, async (req, res) => {
    try {
        const { uid } = req.params;
        const { displayName, currentBalance, initialBalance, isAdmin, disabled } = req.body;

        // Mettre à jour Firebase Auth si nécessaire
        const updateAuth = {};
        if (displayName) updateAuth.displayName = displayName;
        if (typeof disabled === 'boolean') updateAuth.disabled = disabled;

        if (Object.keys(updateAuth).length > 0) {
            await admin.auth().updateUser(uid, updateAuth);
        }

        // Mettre à jour Firestore
        if (firestoreService) {
            const updateData = {};
            if (displayName) updateData.displayName = displayName;
            if (typeof currentBalance === 'number') updateData.currentBalance = currentBalance;
            if (typeof initialBalance === 'number') updateData.initialBalance = initialBalance;
            if (typeof isAdmin === 'boolean') updateData.isAdmin = isAdmin;
            updateData.updatedAt = new Date().toISOString();
            updateData.updatedBy = req.user.uid;

            await firestoreService.upsertUser(uid, updateData);
        }

        res.json({ success: true, message: "User updated" });

    } catch (error) {
        console.error("Error updating user:", error);
        res.status(500).json({ error: "Failed to update user", details: error.message });
    }
});

/**
 * DELETE /api/admin/users/:uid
 * Supprime un utilisateur (admin uniquement)
 */
app.delete('/api/admin/users/:uid', adminMiddleware, async (req, res) => {
    try {
        const { uid } = req.params;

        // Ne pas permettre de se supprimer soi-même
        if (uid === req.user.uid) {
            return res.status(400).json({ error: "Cannot delete yourself" });
        }

        // Supprimer de Firebase Auth
        await admin.auth().deleteUser(uid);

        // Supprimer de Firestore
        if (firestoreService) {
            await firestoreService.db.collection('users').doc(uid).delete();
        }

        res.json({ success: true, message: "User deleted" });

    } catch (error) {
        console.error("Error deleting user:", error);
        res.status(500).json({ error: "Failed to delete user", details: error.message });
    }
});

/**
 * POST /api/admin/users/:uid/reset-password
 * Réinitialise le mot de passe d'un utilisateur (admin uniquement)
 */
app.post('/api/admin/users/:uid/reset-password', adminMiddleware, async (req, res) => {
    try {
        const { uid } = req.params;
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ error: "Password must be at least 6 characters" });
        }

        await admin.auth().updateUser(uid, { password: newPassword });

        res.json({ success: true, message: "Password reset successfully" });

    } catch (error) {
        console.error("Error resetting password:", error);
        res.status(500).json({ error: "Failed to reset password", details: error.message });
    }
});

// ============== ERROR HANDLER ==============

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// ============== START SERVER ==============

app.listen(PORT, () => {
    console.log("\n" + "═".repeat(60));
    console.log(`🚀 E-Cauri API Server V5 running on port ${PORT}`);
    console.log("═".repeat(60));
    console.log(`\n📊 SERVICES STATUS:`);
    console.log(`   Firebase:     ${isFirebaseInitialized ? '✅ Connected (football-opportunities)' : '⚠️ Mock mode'}`);
    console.log(`   Live Data:    ${liveFootballService ? '✅ Ready (API-Football PRO)' : '⚠️ Disabled'}`);
    console.log(`\n🧠 AI ENGINES:`);
    console.log(`   Claude:       ${process.env.ANTHROPIC_API_KEY ? '✅ Ready (Extended Thinking)' : '⚠️ Not configured'}`);
    console.log(`   DeepSeek:     ${process.env.DEEPSEEK_API_KEY ? '✅ Ready (Reasoner)' : '⚠️ Not configured'}`);
    console.log(`\n💰 BOOKMAKERS:`);
    console.log(`   Popular:      ${POPULAR_BOOKMAKERS_AFRICA.length} bookmakers (Africa)`);
    console.log(`   Total:        ${API_FOOTBALL_BOOKMAKERS.length} bookmakers supported`);
    console.log(`\n👑 ADMIN ROUTES:`);
    console.log(`   POST /api/admin/users/create  - Create user`);
    console.log(`   GET  /api/admin/users         - List users`);
    console.log(`   PUT  /api/admin/users/:uid    - Update user`);
    console.log(`   DELETE /api/admin/users/:uid  - Delete user`);
    console.log("\n" + "═".repeat(60));
    console.log(`📌 Endpoints:`);
    console.log(`   GET  /api/health          - Health check`);
    console.log(`   GET  /api/opportunities   - List matches`);
    console.log(`   GET  /api/bookmakers      - List all bookmakers`);
    console.log(`   POST /api/predictions/analyze - AI Analysis`);
    console.log("═".repeat(60) + "\n");
});

module.exports = app;
