/**
 * E-Cauri App - Configuration Firebase
 * Connexion au projet: football-opportunities
 * 
 * Structure des documents "opportunities" (matchs collectés via API-Football):
 * - EQUIPE_A / EQUIPE_B: { id, nom, logo }
 * - CHAMPIONNAT: { id, nom, pays, logo, saison, journee }
 * - DATE_MATCH: { date, timestamp, date_formatee, heure, arbitre }
 * - TERRAIN_DE_JEU: { stade, ville }
 * - CLASSEMENT, STATS_EQUIPE_A/B, MATCHS_RECENTS_A/B
 * - CONFRONTATIONS, COMPOS_PROBABLES, PREDICTIONS, EFFECTIFS, COTES
 * - OPPORTUNITE: { score_opportunite, ... }
 */

const admin = require('firebase-admin');

// ============== INITIALISATION ==============

let db = null;
let auth = null;

function initializeFirebase(serviceAccount) {
    if (admin.apps.length === 0) {
        if (serviceAccount) {
            let credential;
            
            // Si c'est une chaîne JSON
            if (typeof serviceAccount === 'string') {
                try {
                    credential = admin.credential.cert(JSON.parse(serviceAccount));
                } catch {
                    // Si c'est un chemin de fichier
                    const fs = require('fs');
                    const config = JSON.parse(fs.readFileSync(serviceAccount, 'utf8'));
                    credential = admin.credential.cert(config);
                }
            } else {
                credential = admin.credential.cert(serviceAccount);
            }
            
            admin.initializeApp({ credential });
        } else {
            admin.initializeApp();
        }
    }
    
    db = admin.firestore();
    auth = admin.auth();
    
    return { db, auth };
}

// ============== NORMALISATION DES DOCUMENTS OPPORTUNITIES ==============

/**
 * Normalise un document "opportunity" de Firebase vers le format attendu par l'app
 * Convertit la structure française (EQUIPE_A, CHAMPIONNAT...) vers un format standardisé
 */
function normalizeOpportunity(data, docId) {
    // Extraire les informations de base
    const homeTeam = data.EQUIPE_A?.nom || data.homeTeam || 'Équipe A';
    const awayTeam = data.EQUIPE_B?.nom || data.awayTeam || 'Équipe B';
    
    // Déterminer la date du match
    let matchDate = null;
    if (data.DATE_MATCH?.date) {
        matchDate = data.DATE_MATCH.date;
    } else if (data.DATE_MATCH?.timestamp) {
        matchDate = new Date(data.DATE_MATCH.timestamp * 1000).toISOString();
    } else if (data.matchDate) {
        matchDate = data.matchDate instanceof admin.firestore.Timestamp 
            ? data.matchDate.toDate().toISOString() 
            : data.matchDate;
    }

    // Construire l'objet normalisé
    const normalized = {
        // Identifiants
        id: docId,
        fixtureId: data.id || data.fixtureId || docId,
        
        // Équipes
        homeTeam: homeTeam,
        awayTeam: awayTeam,
        homeTeamId: data.EQUIPE_A?.id || data.homeTeamId,
        awayTeamId: data.EQUIPE_B?.id || data.awayTeamId,
        homeTeamLogo: data.EQUIPE_A?.logo || data.homeTeamLogo,
        awayTeamLogo: data.EQUIPE_B?.logo || data.awayTeamLogo,
        
        // Championnat
        league: data.CHAMPIONNAT?.nom || data.league || 'Championnat',
        leagueId: data.CHAMPIONNAT?.id || data.leagueId,
        leagueLogo: data.CHAMPIONNAT?.logo,
        country: data.CHAMPIONNAT?.pays || data.country,
        season: data.CHAMPIONNAT?.saison || data.season,
        round: data.CHAMPIONNAT?.journee || data.round,
        
        // Date et lieu
        matchDate: matchDate,
        matchDateFormatted: data.DATE_MATCH?.date_formatee,
        matchTime: data.DATE_MATCH?.heure,
        referee: data.DATE_MATCH?.arbitre,
        venue: data.TERRAIN_DE_JEU?.stade || data.venue,
        city: data.TERRAIN_DE_JEU?.ville || data.city,
        
        // Statut
        status: data.status || 'upcoming',
        scannedAt: data.scannedAt,
        
        // Stats pour l'analyse IA (format attendu par predictionService)
        stats: {
            // Classement
            standings: data.CLASSEMENT || null,
            
            // Stats des équipes
            teamAStats: data.STATS_EQUIPE_A || null,
            teamBStats: data.STATS_EQUIPE_B || null,
            
            // Matchs récents
            teamARecentMatches: data.MATCHS_RECENTS_A || [],
            teamBRecentMatches: data.MATCHS_RECENTS_B || [],
            
            // Confrontations directes
            headToHead: data.CONFRONTATIONS || null,
            
            // Compositions probables
            lineups: data.COMPOS_PROBABLES || null,
            
            // Prédictions API-Football
            apiPredictions: data.PREDICTIONS || null,
            
            // Effectifs
            squads: data.EFFECTIFS || null
        },
        
        // Cotes
        odds: data.COTES || data.odds || {},
        
        // Score d'opportunité (calculé par API-Football)
        opportunityScore: data.OPPORTUNITE?.score_opportunite || null,
        opportunity: data.OPPORTUNITE || null,
        
        // Conserver les données brutes pour debug
        _raw: data
    };

    return normalized;
}

// ============== SERVICES FIRESTORE ==============

class FirestoreService {
    constructor() {
        if (!db) {
            throw new Error('Firebase not initialized. Call initializeFirebase first.');
        }
        this.db = db;
    }

    // ============== OPPORTUNITIES (MATCHS) ==============

    /**
     * Récupère les opportunités à venir
     */
    async getUpcomingOpportunities() {
        try {
            console.log('📊 Fetching opportunities from Firebase...');
            
            // Récupérer tous les documents de la collection
            const snapshot = await this.db.collection('opportunities')
                .orderBy('scannedAt', 'desc')
                .limit(50)
                .get();

            if (snapshot.empty) {
                console.log('⚠️ No opportunities found in collection');
                return [];
            }

            console.log(`✅ Found ${snapshot.size} opportunities`);

            // Normaliser chaque document
            const opportunities = snapshot.docs.map(doc => {
                const normalized = normalizeOpportunity(doc.data(), doc.id);
                return normalized;
            });

            // Filtrer les matchs à venir (date dans le futur)
            const now = new Date();
            const upcoming = opportunities.filter(opp => {
                if (!opp.matchDate) return true; // Garder si pas de date
                const matchDate = new Date(opp.matchDate);
                return matchDate > now;
            });

            console.log(`📅 ${upcoming.length} upcoming matches (filtered from ${opportunities.length})`);
            
            return upcoming.length > 0 ? upcoming : opportunities;

        } catch (error) {
            console.error('❌ Error fetching opportunities:', error.message);
            // Essayer sans orderBy si index manquant
            if (error.code === 9 || error.message.includes('index')) {
                console.log('⚠️ Retrying without orderBy...');
                const snapshot = await this.db.collection('opportunities').limit(50).get();
                return snapshot.docs.map(doc => normalizeOpportunity(doc.data(), doc.id));
            }
            throw error;
        }
    }

    /**
     * Récupère toutes les opportunités (sans filtre)
     */
    async getAllOpportunities() {
        const snapshot = await this.db.collection('opportunities').get();
        return snapshot.docs.map(doc => normalizeOpportunity(doc.data(), doc.id));
    }

    /**
     * Récupère une opportunité par ID
     */
    async getOpportunityById(opportunityId) {
        const doc = await this.db.collection('opportunities').doc(opportunityId).get();
        
        if (!doc.exists) {
            return null;
        }

        return normalizeOpportunity(doc.data(), doc.id);
    }

    /**
     * Récupère les opportunités en live
     */
    async getLiveOpportunities() {
        try {
            const snapshot = await this.db.collection('opportunities')
                .where('status', '==', 'live')
                .get();
            return snapshot.docs.map(doc => normalizeOpportunity(doc.data(), doc.id));
        } catch {
            return [];
        }
    }

    /**
     * Met à jour le statut d'une opportunité
     */
    async updateOpportunityStatus(opportunityId, status) {
        await this.db.collection('opportunities').doc(opportunityId).update({
            status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    // ============== USERS ==============

    /**
     * Crée ou met à jour un utilisateur
     */
    async upsertUser(userId, userData) {
        const userRef = this.db.collection('users').doc(userId);
        const doc = await userRef.get();

        if (doc.exists) {
            await userRef.update({
                ...userData,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } else {
            await userRef.set({
                ...userData,
                currentBalance: userData.currentBalance || 0,
                settings: {
                    minBet: 90,
                    maxBetPercentage: 6,
                    notifications: true,
                    ...userData.settings
                },
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        return (await userRef.get()).data();
    }

    /**
     * Récupère un utilisateur
     */
    async getUser(userId) {
        const doc = await this.db.collection('users').doc(userId).get();
        return doc.exists ? { id: doc.id, ...doc.data() } : null;
    }

    /**
     * Met à jour le solde d'un utilisateur
     */
    async updateUserBalance(userId, newBalance, reason, predictionId = null) {
        const userRef = this.db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        const previousBalance = userDoc.exists ? userDoc.data().currentBalance || 0 : 0;

        // Mettre à jour le solde
        if (userDoc.exists) {
            await userRef.update({
                currentBalance: newBalance,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } else {
            await userRef.set({
                currentBalance: newBalance,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        // Enregistrer dans l'historique
        await this.db.collection('capitalHistory').add({
            userId,
            previousBalance,
            newBalance,
            change: newBalance - previousBalance,
            reason,
            predictionId,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        return { previousBalance, newBalance, change: newBalance - previousBalance };
    }

    /**
     * Met à jour les paramètres utilisateur
     */
    async updateUserSettings(userId, settings) {
        await this.db.collection('users').doc(userId).update({
            settings,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    // ============== PREDICTIONS ==============

    /**
     * Crée une nouvelle prédiction
     */
    async createPrediction(predictionData) {
        const docRef = await this.db.collection('predictions').add({
            ...predictionData,
            status: 'active',
            hedgingHistory: [],
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { id: docRef.id, ...predictionData };
    }

    /**
     * Récupère les prédictions d'un utilisateur
     */
    async getUserPredictions(userId, status = null) {
        try {
            let query = this.db.collection('predictions')
                .where('userId', '==', userId)
                .orderBy('createdAt', 'desc')
                .limit(50);

            const snapshot = await query.get();

            let predictions = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Filtrer par status si spécifié
            if (status) {
                predictions = predictions.filter(p => p.status === status);
            }

            return predictions;
        } catch (error) {
            // Si index manquant, essayer sans orderBy
            if (error.code === 9) {
                const snapshot = await this.db.collection('predictions')
                    .where('userId', '==', userId)
                    .limit(50)
                    .get();
                return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            }
            throw error;
        }
    }

    /**
     * Récupère une prédiction par ID
     */
    async getPredictionById(predictionId) {
        const doc = await this.db.collection('predictions').doc(predictionId).get();
        return doc.exists ? { id: doc.id, ...doc.data() } : null;
    }

    /**
     * Met à jour une prédiction
     */
    async updatePrediction(predictionId, updateData) {
        await this.db.collection('predictions').doc(predictionId).update({
            ...updateData,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    /**
     * Ajoute une action de hedging à l'historique
     */
    async addHedgingAction(predictionId, hedgingAction) {
        await this.db.collection('predictions').doc(predictionId).update({
            hedgingHistory: admin.firestore.FieldValue.arrayUnion({
                ...hedgingAction,
                timestamp: new Date().toISOString()
            }),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    /**
     * Finalise une prédiction (résultat final)
     */
    async finalizePrediction(predictionId, result) {
        await this.db.collection('predictions').doc(predictionId).update({
            status: result.profit > 0 ? 'won' : result.profit < 0 ? 'lost' : 'partial',
            result,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    // ============== USER ACTIONS (AUDIT TRAIL) ==============

    /**
     * Enregistre une action utilisateur
     */
    async logUserAction(userId, actionType, details = {}, relatedIds = {}) {
        await this.db.collection('userActions').add({
            userId,
            actionType,
            details,
            ...relatedIds,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    /**
     * Récupère l'historique des actions d'un utilisateur
     */
    async getUserActions(userId, limit = 50) {
        try {
            const snapshot = await this.db.collection('userActions')
                .where('userId', '==', userId)
                .orderBy('timestamp', 'desc')
                .limit(limit)
                .get();

            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch {
            const snapshot = await this.db.collection('userActions')
                .where('userId', '==', userId)
                .limit(limit)
                .get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }
    }

    // ============== CAPITAL HISTORY ==============

    /**
     * Récupère l'historique du capital d'un utilisateur
     */
    async getCapitalHistory(userId, limit = 30) {
        try {
            const snapshot = await this.db.collection('capitalHistory')
                .where('userId', '==', userId)
                .orderBy('timestamp', 'desc')
                .limit(limit)
                .get();

            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch {
            const snapshot = await this.db.collection('capitalHistory')
                .where('userId', '==', userId)
                .limit(limit)
                .get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }
    }

    /**
     * Calcule les statistiques du capital
     */
    async getCapitalStats(userId) {
        const history = await this.getCapitalHistory(userId, 100);
        
        if (history.length === 0) {
            return {
                currentBalance: 0,
                totalGains: 0,
                totalLosses: 0,
                netProfit: 0,
                winRate: 0,
                totalBets: 0
            };
        }

        const gains = history.filter(h => h.change > 0).reduce((sum, h) => sum + h.change, 0);
        const losses = history.filter(h => h.change < 0).reduce((sum, h) => sum + Math.abs(h.change), 0);
        const wins = history.filter(h => h.change > 0).length;
        const total = history.filter(h => h.reason?.includes('prediction')).length;

        return {
            currentBalance: history[0]?.newBalance || 0,
            totalGains: gains,
            totalLosses: losses,
            netProfit: gains - losses,
            winRate: total > 0 ? (wins / total) * 100 : 0,
            totalBets: total
        };
    }

    // ============== FORMATIONS ==============

    /**
     * Récupère toutes les formations publiées
     */
    async getFormations() {
        try {
            const snapshot = await this.db.collection('formations')
                .where('isPublished', '==', true)
                .orderBy('order', 'asc')
                .get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch {
            const snapshot = await this.db.collection('formations').get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }
    }

    /**
     * Récupère une formation par ID
     */
    async getFormationById(formationId) {
        const doc = await this.db.collection('formations').doc(formationId).get();
        return doc.exists ? { id: doc.id, ...doc.data() } : null;
    }

    // ============== LIVE TRACKING ==============

    /**
     * Met à jour le statut live d'une prédiction
     */
    async updatePredictionLiveStatus(predictionId, liveData) {
        await this.db.collection('predictions').doc(predictionId).update({
            liveStatus: liveData,
            lastLiveUpdate: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    /**
     * Enregistre le résultat d'une option de pari
     */
    async updateOptionResult(predictionId, optionIndex, result) {
        const prediction = await this.getPredictionById(predictionId);
        if (!prediction) return null;

        const selectedOptions = prediction.selectedOptions || [];
        if (selectedOptions[optionIndex]) {
            selectedOptions[optionIndex] = {
                ...selectedOptions[optionIndex],
                result: result.status, // 'won', 'lost', 'pending'
                actualOdds: result.actualOdds,
                profit: result.profit,
                updatedAt: new Date().toISOString()
            };

            await this.db.collection('predictions').doc(predictionId).update({
                selectedOptions,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        return selectedOptions;
    }

    /**
     * Finalise toutes les options d'une prédiction et calcule le profit
     */
    async finalizePredictionWithResults(predictionId, userId, results) {
        const prediction = await this.getPredictionById(predictionId);
        if (!prediction) return null;

        let totalProfit = 0;
        let wonCount = 0;
        let lostCount = 0;

        const finalizedOptions = (prediction.selectedOptions || []).map((opt, index) => {
            const result = results[index] || { status: 'lost', profit: -(opt.stake || 0) };
            totalProfit += result.profit || 0;
            if (result.status === 'won') wonCount++;
            if (result.status === 'lost') lostCount++;
            
            return {
                ...opt,
                result: result.status,
                profit: result.profit,
                finalizedAt: new Date().toISOString()
            };
        });

        const status = totalProfit > 0 ? 'won' : totalProfit < 0 ? 'lost' : 'breakeven';

        await this.db.collection('predictions').doc(predictionId).update({
            selectedOptions: finalizedOptions,
            status,
            finalResult: {
                totalProfit,
                wonCount,
                lostCount,
                finalizedAt: new Date().toISOString()
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Mettre à jour le capital de l'utilisateur
        if (userId && totalProfit !== 0) {
            const user = await this.getUser(userId);
            const currentBalance = user?.currentBalance || 0;
            await this.updateUserBalance(
                userId, 
                currentBalance + totalProfit, 
                `prediction_result_${status}`,
                predictionId
            );
        }

        return { status, totalProfit, wonCount, lostCount };
    }

    /**
     * Récupère les prédictions actives (en cours de match)
     */
    async getActivePredictionsForLiveTracking() {
        try {
            const snapshot = await this.db.collection('predictions')
                .where('status', 'in', ['active', 'live'])
                .get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch {
            return [];
        }
    }

    // ============== USER RECOMMENDATIONS ==============

    /**
     * Sauvegarde une recommandation générée par l'IA
     */
    async saveRecommendation(userId, recommendation) {
        const docRef = await this.db.collection('recommendations').add({
            userId,
            ...recommendation,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return { id: docRef.id, ...recommendation };
    }

    /**
     * Récupère les recommandations d'un utilisateur
     */
    async getUserRecommendations(userId, limit = 10) {
        try {
            const snapshot = await this.db.collection('recommendations')
                .where('userId', '==', userId)
                .orderBy('createdAt', 'desc')
                .limit(limit)
                .get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch {
            const snapshot = await this.db.collection('recommendations')
                .where('userId', '==', userId)
                .limit(limit)
                .get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }
    }

    /**
     * Récupère les statistiques complètes de l'utilisateur pour les recommandations
     */
    async getUserFullStats(userId) {
        const [user, predictions, capitalHistory, actions] = await Promise.all([
            this.getUser(userId),
            this.getUserPredictions(userId),
            this.getCapitalHistory(userId, 100),
            this.getUserActions(userId, 200)
        ]);

        // Analyser les prédictions
        const completedPredictions = predictions.filter(p => ['won', 'lost', 'breakeven'].includes(p.status));
        const wonPredictions = completedPredictions.filter(p => p.status === 'won');
        const lostPredictions = completedPredictions.filter(p => p.status === 'lost');

        // Calculer les statistiques par type d'option
        const optionStats = {};
        completedPredictions.forEach(pred => {
            (pred.selectedOptions || []).forEach(opt => {
                const optionType = this.categorizeOption(opt.option);
                if (!optionStats[optionType]) {
                    optionStats[optionType] = { total: 0, won: 0, totalStake: 0, totalProfit: 0 };
                }
                optionStats[optionType].total++;
                if (opt.result === 'won') optionStats[optionType].won++;
                optionStats[optionType].totalStake += opt.stake || 0;
                optionStats[optionType].totalProfit += opt.profit || 0;
            });
        });

        // Calculer les tendances
        const recentPredictions = completedPredictions.slice(0, 20);
        const recentWinRate = recentPredictions.length > 0 
            ? (recentPredictions.filter(p => p.status === 'won').length / recentPredictions.length) * 100 
            : 0;

        return {
            user: {
                currentBalance: user?.currentBalance || 0,
                settings: user?.settings || {}
            },
            predictions: {
                total: predictions.length,
                active: predictions.filter(p => p.status === 'active').length,
                won: wonPredictions.length,
                lost: lostPredictions.length,
                winRate: completedPredictions.length > 0 
                    ? (wonPredictions.length / completedPredictions.length) * 100 
                    : 0,
                recentWinRate
            },
            capital: {
                history: capitalHistory.slice(0, 30),
                totalGains: capitalHistory.filter(h => h.change > 0).reduce((sum, h) => sum + h.change, 0),
                totalLosses: Math.abs(capitalHistory.filter(h => h.change < 0).reduce((sum, h) => sum + h.change, 0)),
                averageBet: capitalHistory.length > 0 
                    ? capitalHistory.reduce((sum, h) => sum + Math.abs(h.change), 0) / capitalHistory.length 
                    : 0
            },
            optionStats,
            recentActivity: actions.slice(0, 50)
        };
    }

    /**
     * Catégorise une option de pari
     */
    categorizeOption(optionName) {
        const lowerName = (optionName || '').toLowerCase();
        if (lowerName.includes('victoire') || lowerName.includes('win') || lowerName.includes('1x2')) return '1X2';
        if (lowerName.includes('btts') || lowerName.includes('deux équipes')) return 'BTTS';
        if (lowerName.includes('plus de') || lowerName.includes('over') || lowerName.includes('moins de') || lowerName.includes('under')) return 'TOTALS';
        if (lowerName.includes('handicap')) return 'HANDICAP';
        if (lowerName.includes('score')) return 'CORRECT_SCORE';
        if (lowerName.includes('double chance') || lowerName.includes('1x') || lowerName.includes('x2')) return 'DOUBLE_CHANCE';
        return 'OTHER';
    }
}

// ============== EXPORTS ==============

module.exports = {
    initializeFirebase,
    FirestoreService,
    admin,
    normalizeOpportunity
};
