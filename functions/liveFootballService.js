/**
 * E-Cauri App - Service API-Football (Plan PRO)
 * Récupère UNIQUEMENT les données LIVE (stats en temps réel + cotes)
 * 
 * Documentation: https://www.api-football.com/documentation-v3
 */

const API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io";

class LiveFootballService {
    constructor(apiKey) {
        if (!apiKey) {
            console.warn("⚠️ API-Football key not provided - live features disabled");
        }
        this.apiKey = apiKey;
        this.headers = {
            "x-rapidapi-host": "v3.football.api-sports.io",
            "x-rapidapi-key": apiKey
        };
    }

    /**
     * Requête générique vers l'API
     */
    async makeRequest(endpoint, params = {}) {
        if (!this.apiKey) {
            throw new Error("API-Football key not configured");
        }

        const url = new URL(`${API_FOOTBALL_BASE_URL}${endpoint}`);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                url.searchParams.append(key, value);
            }
        });

        console.log(`📡 API-Football: ${endpoint}`);

        const response = await fetch(url.toString(), {
            method: "GET",
            headers: this.headers
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`API-Football error ${response.status}: ${error}`);
        }

        const data = await response.json();
        
        // Vérifier les erreurs de l'API
        if (data.errors && Object.keys(data.errors).length > 0) {
            console.error("API-Football errors:", data.errors);
            throw new Error(`API-Football: ${JSON.stringify(data.errors)}`);
        }

        return data.response;
    }

    // ============== DONNÉES LIVE ==============

    /**
     * Récupère les statistiques en temps réel d'un match
     * @param {number} fixtureId - ID du match sur API-Football
     */
    async getLiveStats(fixtureId) {
        const fixtures = await this.makeRequest("/fixtures", { id: fixtureId });

        if (!fixtures || fixtures.length === 0) {
            return null;
        }

        const match = fixtures[0];

        return {
            fixture: {
                id: match.fixture.id,
                status: match.fixture.status.short,
                statusLong: match.fixture.status.long,
                elapsed: match.fixture.status.elapsed,
                venue: match.fixture.venue?.name
            },
            score: {
                home: match.goals.home,
                away: match.goals.away,
                halftime: match.score.halftime,
                fulltime: match.score.fulltime
            },
            teams: {
                home: {
                    id: match.teams.home.id,
                    name: match.teams.home.name,
                    logo: match.teams.home.logo,
                    winner: match.teams.home.winner
                },
                away: {
                    id: match.teams.away.id,
                    name: match.teams.away.name,
                    logo: match.teams.away.logo,
                    winner: match.teams.away.winner
                }
            },
            events: match.events || [],
            lineups: match.lineups || [],
            statistics: match.statistics || []
        };
    }

    /**
     * Récupère les statistiques détaillées d'un match en cours
     * @param {number} fixtureId - ID du match
     */
    async getLiveMatchStatistics(fixtureId) {
        const stats = await this.makeRequest("/fixtures/statistics", { fixture: fixtureId });

        if (!stats || stats.length === 0) {
            return null;
        }

        // Transformer les stats en format plus lisible
        const formatStats = (teamStats) => {
            const result = {};
            teamStats.statistics.forEach(stat => {
                result[stat.type] = stat.value;
            });
            return result;
        };

        return {
            home: {
                team: stats[0]?.team,
                stats: formatStats(stats[0] || { statistics: [] })
            },
            away: {
                team: stats[1]?.team,
                stats: formatStats(stats[1] || { statistics: [] })
            }
        };
    }

    /**
     * Récupère les événements en direct (buts, cartons, etc.)
     * @param {number} fixtureId - ID du match
     */
    async getLiveEvents(fixtureId) {
        const events = await this.makeRequest("/fixtures/events", { fixture: fixtureId });

        return events.map(event => ({
            time: event.time.elapsed + (event.time.extra || 0),
            team: event.team.name,
            teamId: event.team.id,
            player: event.player.name,
            playerId: event.player.id,
            assist: event.assist?.name,
            type: event.type,
            detail: event.detail,
            comments: event.comments
        }));
    }

    /**
     * Récupère les compositions officielles
     * @param {number} fixtureId - ID du match
     */
    async getLiveLineups(fixtureId) {
        const lineups = await this.makeRequest("/fixtures/lineups", { fixture: fixtureId });

        if (!lineups || lineups.length === 0) {
            return null;
        }

        const formatLineup = (lineup) => ({
            team: lineup.team,
            formation: lineup.formation,
            startXI: lineup.startXI.map(p => ({
                id: p.player.id,
                name: p.player.name,
                number: p.player.number,
                pos: p.player.pos,
                grid: p.player.grid
            })),
            substitutes: lineup.substitutes.map(p => ({
                id: p.player.id,
                name: p.player.name,
                number: p.player.number,
                pos: p.player.pos
            })),
            coach: lineup.coach
        });

        return {
            home: formatLineup(lineups[0]),
            away: formatLineup(lineups[1])
        };
    }

    // ============== COTES EN DIRECT ==============

    /**
     * Récupère les cotes en direct pour un match
     * @param {number} fixtureId - ID du match
     * @param {number} bookmaker - ID du bookmaker (optionnel)
     */
    async getLiveOdds(fixtureId, bookmakerId = null) {
        const params = { fixture: fixtureId };
        if (bookmakerId) {
            params.bookmaker = bookmakerId;
        }

        const odds = await this.makeRequest("/odds/live", params);

        if (!odds || odds.length === 0) {
            return null;
        }

        // Formater les cotes par type de pari
        const formatOdds = (oddsData) => {
            const result = {
                fixture: oddsData.fixture,
                update: oddsData.update,
                bookmakers: {}
            };

            oddsData.odds.forEach(bookmaker => {
                result.bookmakers[bookmaker.name] = {};
                bookmaker.values.forEach(bet => {
                    result.bookmakers[bookmaker.name][bet.value] = parseFloat(bet.odd);
                });
            });

            return result;
        };

        return odds.map(formatOdds);
    }

    /**
     * Récupère les cotes pré-match pour un match
     * @param {number} fixtureId - ID du match
     */
    async getPreMatchOdds(fixtureId) {
        const odds = await this.makeRequest("/odds", { fixture: fixtureId });

        if (!odds || odds.length === 0) {
            return null;
        }

        // Organiser les cotes par bookmaker et type de pari
        const result = {};

        odds.forEach(oddsData => {
            oddsData.bookmakers.forEach(bookmaker => {
                if (!result[bookmaker.name]) {
                    result[bookmaker.name] = {};
                }

                bookmaker.bets.forEach(bet => {
                    if (!result[bookmaker.name][bet.name]) {
                        result[bookmaker.name][bet.name] = {};
                    }

                    bet.values.forEach(value => {
                        result[bookmaker.name][bet.name][value.value] = parseFloat(value.odd);
                    });
                });
            });
        });

        return result;
    }

    // ============== DONNÉES COMPLÈTES LIVE ==============

    /**
     * Récupère toutes les données live d'un match
     * @param {number} fixtureId - ID du match
     */
    async getFullLiveData(fixtureId) {
        console.log(`🔴 Fetching full live data for fixture ${fixtureId}...`);

        try {
            const [liveStats, statistics, events, lineups, liveOdds] = await Promise.allSettled([
                this.getLiveStats(fixtureId),
                this.getLiveMatchStatistics(fixtureId),
                this.getLiveEvents(fixtureId),
                this.getLiveLineups(fixtureId),
                this.getLiveOdds(fixtureId)
            ]);

            return {
                match: liveStats.status === 'fulfilled' ? liveStats.value : null,
                statistics: statistics.status === 'fulfilled' ? statistics.value : null,
                events: events.status === 'fulfilled' ? events.value : [],
                lineups: lineups.status === 'fulfilled' ? lineups.value : null,
                odds: liveOdds.status === 'fulfilled' ? liveOdds.value : null,
                fetchedAt: new Date().toISOString()
            };

        } catch (error) {
            console.error("Error fetching live data:", error);
            throw error;
        }
    }

    // ============== BOOKMAKERS ==============

    /**
     * Liste des IDs de bookmakers courants sur API-Football
     */
    static BOOKMAKER_IDS = {
        '1xbet': 80,
        'bet365': 8,
        'betway': 17,
        'unibet': 16,
        'bwin': 1,
        'williamhill': 11,
        'betfair': 6,
        'pinnacle': 4
    };

    /**
     * Récupère l'ID du bookmaker
     */
    static getBookmakerId(bookmakerName) {
        const name = bookmakerName.toLowerCase().replace(/[^a-z0-9]/g, '');
        return this.BOOKMAKER_IDS[name] || null;
    }

    // ============== UTILITAIRES ==============

    /**
     * Vérifie si l'API est accessible
     */
    async checkConnection() {
        try {
            await this.makeRequest("/status");
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Récupère les informations de quota API
     */
    async getApiStatus() {
        const status = await this.makeRequest("/status");
        return status;
    }

    /**
     * Formate les statistiques live pour l'affichage
     */
    static formatLiveStatsForDisplay(statistics) {
        if (!statistics) return null;

        const homeStats = statistics.home?.stats || {};
        const awayStats = statistics.away?.stats || {};

        return {
            possession: {
                home: parseInt(homeStats['Ball Possession']?.replace('%', '') || 50),
                away: parseInt(awayStats['Ball Possession']?.replace('%', '') || 50)
            },
            shots: {
                home: homeStats['Total Shots'] || 0,
                away: awayStats['Total Shots'] || 0
            },
            shotsOnTarget: {
                home: homeStats['Shots on Goal'] || 0,
                away: awayStats['Shots on Goal'] || 0
            },
            corners: {
                home: homeStats['Corner Kicks'] || 0,
                away: awayStats['Corner Kicks'] || 0
            },
            fouls: {
                home: homeStats['Fouls'] || 0,
                away: awayStats['Fouls'] || 0
            },
            yellowCards: {
                home: homeStats['Yellow Cards'] || 0,
                away: awayStats['Yellow Cards'] || 0
            },
            redCards: {
                home: homeStats['Red Cards'] || 0,
                away: awayStats['Red Cards'] || 0
            },
            passes: {
                home: homeStats['Total passes'] || 0,
                away: awayStats['Total passes'] || 0
            },
            passAccuracy: {
                home: parseInt(homeStats['Passes %']?.replace('%', '') || 0),
                away: parseInt(awayStats['Passes %']?.replace('%', '') || 0)
            }
        };
    }

    /**
     * Formate les cotes pour le service de prédiction
     */
    static formatOddsForPrediction(odds, bookmakerName = null) {
        if (!odds) return null;

        // Si un bookmaker spécifique est demandé
        if (bookmakerName && odds.bookmakers?.[bookmakerName]) {
            return odds.bookmakers[bookmakerName];
        }

        // Sinon, utiliser le premier bookmaker disponible
        const firstBookmaker = Object.keys(odds.bookmakers || {})[0];
        return firstBookmaker ? odds.bookmakers[firstBookmaker] : null;
    }

    // ============== SUIVI DES PARIS ==============

    /**
     * Statuts de match possibles sur API-Football
     */
    static MATCH_STATUS = {
        NOT_STARTED: ['TBD', 'NS'],
        LIVE: ['1H', '2H', 'ET', 'BT', 'P', 'LIVE'],
        HALFTIME: ['HT'],
        FINISHED: ['FT', 'AET', 'PEN'],
        SUSPENDED: ['SUSP', 'INT'],
        POSTPONED: ['PST', 'CANC', 'ABD', 'AWD', 'WO']
    };

    /**
     * Vérifie si un match a commencé
     */
    static hasMatchStarted(status) {
        return this.MATCH_STATUS.LIVE.includes(status) || 
               this.MATCH_STATUS.HALFTIME.includes(status) ||
               this.MATCH_STATUS.FINISHED.includes(status);
    }

    /**
     * Vérifie si le match est à la mi-temps ou après
     */
    static isHalftimeOrLater(status) {
        return this.MATCH_STATUS.HALFTIME.includes(status) ||
               status === '2H' || 
               status === 'ET' ||
               this.MATCH_STATUS.FINISHED.includes(status);
    }

    /**
     * Vérifie si le match est terminé
     */
    static isMatchFinished(status) {
        return this.MATCH_STATUS.FINISHED.includes(status);
    }

    /**
     * Vérifie si la stratégie de couverture peut être activée
     * (match en cours ET au moins à la mi-temps)
     */
    static canActivateHedging(status, elapsed) {
        // Match en cours et au moins 40 minutes jouées
        if (this.MATCH_STATUS.LIVE.includes(status) && elapsed >= 40) {
            return true;
        }
        // Mi-temps
        if (this.MATCH_STATUS.HALFTIME.includes(status)) {
            return true;
        }
        // Deuxième mi-temps
        if (status === '2H') {
            return true;
        }
        return false;
    }

    /**
     * Récupère le statut actuel d'un match
     */
    async getMatchStatus(fixtureId) {
        try {
            const liveStats = await this.getLiveStats(fixtureId);
            if (!liveStats) return null;

            const status = liveStats.fixture.status;
            const elapsed = liveStats.fixture.elapsed || 0;

            return {
                fixtureId,
                status,
                statusLong: liveStats.fixture.statusLong,
                elapsed,
                score: liveStats.score,
                hasStarted: LiveFootballService.hasMatchStarted(status),
                isHalftimeOrLater: LiveFootballService.isHalftimeOrLater(status),
                isFinished: LiveFootballService.isMatchFinished(status),
                canHedge: LiveFootballService.canActivateHedging(status, elapsed),
                teams: liveStats.teams,
                fetchedAt: new Date().toISOString()
            };
        } catch (error) {
            console.error(`Error getting match status for ${fixtureId}:`, error.message);
            return null;
        }
    }

    /**
     * Évalue le statut d'une option de pari basée sur le score actuel
     */
    evaluateBetOption(optionName, score, status, odds) {
        const homeGoals = score.home || 0;
        const awayGoals = score.away || 0;
        const totalGoals = homeGoals + awayGoals;
        const isFinished = LiveFootballService.isMatchFinished(status);

        const option = optionName.toLowerCase();
        let result = { status: 'pending', probability: 0.5, profit: 0 };

        // Victoire équipe domicile
        if (option.includes('victoire') && (option.includes('domicile') || option.match(/^victoire\s+\w+$/))) {
            if (homeGoals > awayGoals) {
                result = { status: isFinished ? 'won' : 'winning', probability: 0.7 };
            } else if (homeGoals < awayGoals) {
                result = { status: isFinished ? 'lost' : 'losing', probability: 0.2 };
            } else {
                result = { status: 'pending', probability: 0.4 };
            }
        }

        // Match nul
        if (option.includes('nul') || option.includes('draw')) {
            if (homeGoals === awayGoals) {
                result = { status: isFinished ? 'won' : 'winning', probability: 0.6 };
            } else {
                result = { status: isFinished ? 'lost' : 'losing', probability: 0.3 };
            }
        }

        // BTTS (Both Teams To Score)
        if (option.includes('btts') || option.includes('deux équipes marquent')) {
            const bttsYes = option.includes('oui') || option.includes('yes');
            const bothScored = homeGoals > 0 && awayGoals > 0;
            
            if (bttsYes) {
                if (bothScored) {
                    result = { status: 'won', probability: 1 };
                } else if (isFinished) {
                    result = { status: 'lost', probability: 0 };
                } else {
                    result = { status: 'pending', probability: 0.5 };
                }
            } else {
                if (bothScored) {
                    result = { status: 'lost', probability: 0 };
                } else if (isFinished) {
                    result = { status: 'won', probability: 1 };
                } else {
                    result = { status: 'pending', probability: 0.5 };
                }
            }
        }

        // Over/Under buts
        const overMatch = option.match(/plus de (\d+\.?\d*)/i);
        const underMatch = option.match(/moins de (\d+\.?\d*)/i);

        if (overMatch) {
            const threshold = parseFloat(overMatch[1]);
            if (totalGoals > threshold) {
                result = { status: 'won', probability: 1 };
            } else if (isFinished) {
                result = { status: 'lost', probability: 0 };
            } else {
                result = { status: 'pending', probability: totalGoals >= threshold ? 0.7 : 0.4 };
            }
        }

        if (underMatch) {
            const threshold = parseFloat(underMatch[1]);
            if (totalGoals >= threshold) {
                result = { status: 'lost', probability: 0 };
            } else if (isFinished) {
                result = { status: 'won', probability: 1 };
            } else {
                result = { status: 'pending', probability: 0.5 };
            }
        }

        return result;
    }

    /**
     * Évalue toutes les options d'une prédiction
     */
    async evaluatePredictionOptions(fixtureId, selectedOptions) {
        const matchStatus = await this.getMatchStatus(fixtureId);
        if (!matchStatus) return null;

        const evaluatedOptions = selectedOptions.map(opt => {
            const evaluation = this.evaluateBetOption(
                opt.option,
                matchStatus.score,
                matchStatus.status,
                opt.odds
            );

            const stake = opt.stake || opt.adjustedStake || 0;
            let profit = 0;

            if (evaluation.status === 'won') {
                profit = stake * (opt.odds - 1);
            } else if (evaluation.status === 'lost') {
                profit = -stake;
            }

            return {
                ...opt,
                currentStatus: evaluation.status,
                probability: evaluation.probability,
                potentialProfit: stake * (opt.odds - 1),
                currentProfit: profit
            };
        });

        return {
            matchStatus,
            options: evaluatedOptions,
            canHedge: matchStatus.canHedge,
            evaluatedAt: new Date().toISOString()
        };
    }

    // ============== SUIVI EN TEMPS RÉEL AVANCÉ ==============

    /**
     * Calcule la probabilité dynamique de validation d'une option
     * Basée sur le score actuel, le temps restant, et l'évolution des cotes
     */
    calculateDynamicProbability(optionName, score, elapsed, originalOdds, currentOdds) {
        const homeGoals = score.home || 0;
        const awayGoals = score.away || 0;
        const totalGoals = homeGoals + awayGoals;
        const timeRemaining = Math.max(0, 90 - (elapsed || 0));
        const timeProgress = elapsed / 90; // 0 à 1
        
        const option = optionName.toLowerCase();
        let baseProbability = 0.5;
        let trend = 'stable'; // stable, up, down

        // Calculer le trend basé sur l'évolution des cotes
        if (originalOdds && currentOdds) {
            const oddsChange = ((originalOdds - currentOdds) / originalOdds) * 100;
            if (oddsChange > 5) trend = 'up'; // Cote a baissé = plus probable
            else if (oddsChange < -5) trend = 'down'; // Cote a monté = moins probable
        }

        // Victoire domicile
        if (option.includes('victoire') && !option.includes('extérieur')) {
            if (homeGoals > awayGoals) {
                // Mène au score
                const goalDiff = homeGoals - awayGoals;
                baseProbability = 0.6 + (goalDiff * 0.15) + (timeProgress * 0.15);
            } else if (homeGoals < awayGoals) {
                // Derrière au score
                const goalDiff = awayGoals - homeGoals;
                baseProbability = 0.4 - (goalDiff * 0.15) - (timeProgress * 0.1);
            } else {
                // Match nul
                baseProbability = 0.35 - (timeProgress * 0.1);
            }
        }

        // Victoire extérieur
        if (option.includes('victoire') && option.includes('extérieur')) {
            if (awayGoals > homeGoals) {
                const goalDiff = awayGoals - homeGoals;
                baseProbability = 0.6 + (goalDiff * 0.15) + (timeProgress * 0.15);
            } else if (awayGoals < homeGoals) {
                const goalDiff = homeGoals - awayGoals;
                baseProbability = 0.4 - (goalDiff * 0.15) - (timeProgress * 0.1);
            } else {
                baseProbability = 0.35 - (timeProgress * 0.1);
            }
        }

        // Match nul
        if (option.includes('nul') || option.includes('draw')) {
            if (homeGoals === awayGoals) {
                baseProbability = 0.4 + (timeProgress * 0.3); // Plus probable avec le temps
            } else {
                const goalDiff = Math.abs(homeGoals - awayGoals);
                baseProbability = 0.3 - (goalDiff * 0.15) - (timeProgress * 0.1);
            }
        }

        // BTTS
        if (option.includes('btts') || option.includes('deux équipes marquent')) {
            const bttsYes = option.includes('oui') || option.includes('yes');
            const bothScored = homeGoals > 0 && awayGoals > 0;
            
            if (bttsYes) {
                if (bothScored) {
                    baseProbability = 1.0; // Validé
                } else if (homeGoals > 0 || awayGoals > 0) {
                    // Une équipe a marqué
                    baseProbability = 0.5 + ((1 - timeProgress) * 0.3);
                } else {
                    // 0-0
                    baseProbability = 0.4 - (timeProgress * 0.2);
                }
            } else {
                if (bothScored) {
                    baseProbability = 0; // Perdu
                } else {
                    baseProbability = 0.5 + (timeProgress * 0.3);
                }
            }
        }

        // Over X.5 buts
        const overMatch = option.match(/plus de (\d+\.?\d*)/i);
        if (overMatch) {
            const threshold = parseFloat(overMatch[1]);
            if (totalGoals > threshold) {
                baseProbability = 1.0; // Validé
            } else {
                const goalsNeeded = Math.ceil(threshold + 0.5) - totalGoals;
                // Estimer la probabilité basée sur les buts restants nécessaires et le temps
                const avgGoalsPerMinute = 2.5 / 90; // Moyenne 2.5 buts par match
                const expectedRemainingGoals = avgGoalsPerMinute * timeRemaining;
                baseProbability = Math.min(0.9, expectedRemainingGoals / goalsNeeded);
            }
        }

        // Under X.5 buts
        const underMatch = option.match(/moins de (\d+\.?\d*)/i);
        if (underMatch) {
            const threshold = parseFloat(underMatch[1]);
            if (totalGoals >= threshold) {
                baseProbability = 0; // Perdu
            } else {
                // Plus le temps passe sans buts, plus la probabilité augmente
                baseProbability = 0.5 + (timeProgress * 0.4);
            }
        }

        // Ajuster selon le trend des cotes
        if (trend === 'up') baseProbability = Math.min(0.95, baseProbability * 1.1);
        else if (trend === 'down') baseProbability = Math.max(0.05, baseProbability * 0.9);

        // Limiter entre 0 et 1
        baseProbability = Math.max(0, Math.min(1, baseProbability));

        return {
            probability: Math.round(baseProbability * 100),
            trend,
            confidence: timeProgress > 0.7 ? 'high' : timeProgress > 0.4 ? 'medium' : 'low'
        };
    }

    /**
     * Récupère les cotes live pour un bookmaker spécifique
     * @param {number} fixtureId - ID du match
     * @param {string} bookmakerName - Nom du bookmaker
     */
    async getLiveOddsForBookmaker(fixtureId, bookmakerName) {
        try {
            const bookmakerId = LiveFootballService.getBookmakerId(bookmakerName);
            
            // D'abord essayer les cotes live
            const liveOdds = await this.getLiveOdds(fixtureId, bookmakerId);
            
            if (liveOdds && liveOdds.length > 0) {
                // Chercher le bookmaker demandé ou utiliser le premier disponible
                for (const oddsData of liveOdds) {
                    if (oddsData.bookmakers) {
                        // Chercher le bookmaker spécifique (insensible à la casse)
                        const bookmakerKey = Object.keys(oddsData.bookmakers).find(
                            k => k.toLowerCase().includes(bookmakerName.toLowerCase()) ||
                                 bookmakerName.toLowerCase().includes(k.toLowerCase())
                        );
                        
                        if (bookmakerKey && oddsData.bookmakers[bookmakerKey]) {
                            console.log(`✅ Live odds found for ${bookmakerKey}`);
                            return {
                                bookmaker: bookmakerKey,
                                odds: oddsData.bookmakers[bookmakerKey],
                                isLive: true,
                                source: 'live',
                                update: oddsData.update,
                                allBookmakers: Object.keys(oddsData.bookmakers)
                            };
                        }
                        
                        // Sinon prendre le premier bookmaker disponible
                        const firstBookmaker = Object.keys(oddsData.bookmakers)[0];
                        if (firstBookmaker) {
                            console.log(`⚠️ Using alternative bookmaker: ${firstBookmaker} (requested: ${bookmakerName})`);
                            return {
                                bookmaker: firstBookmaker,
                                odds: oddsData.bookmakers[firstBookmaker],
                                isLive: true,
                                source: 'live-alternative',
                                update: oddsData.update,
                                allBookmakers: Object.keys(oddsData.bookmakers)
                            };
                        }
                    }
                }
            }
            
            // Fallback: essayer les cotes pré-match
            console.log('📋 Falling back to pre-match odds...');
            const preMatchOdds = await this.getPreMatchOdds(fixtureId);
            
            if (preMatchOdds) {
                // Chercher le bookmaker demandé
                const bookmakerKey = Object.keys(preMatchOdds).find(
                    k => k.toLowerCase().includes(bookmakerName.toLowerCase()) ||
                         bookmakerName.toLowerCase().includes(k.toLowerCase())
                );
                
                if (bookmakerKey && preMatchOdds[bookmakerKey]) {
                    // Aplatir les cotes pré-match (elles sont organisées par type de pari)
                    const flatOdds = {};
                    for (const [betType, values] of Object.entries(preMatchOdds[bookmakerKey])) {
                        for (const [outcome, odd] of Object.entries(values)) {
                            flatOdds[outcome] = odd;
                            // Aussi ajouter avec le type de pari comme préfixe
                            flatOdds[`${betType} - ${outcome}`] = odd;
                        }
                    }
                    
                    console.log(`✅ Pre-match odds found for ${bookmakerKey}`);
                    return {
                        bookmaker: bookmakerKey,
                        odds: flatOdds,
                        isLive: false,
                        source: 'pre-match',
                        allBookmakers: Object.keys(preMatchOdds)
                    };
                }
                
                // Prendre le premier bookmaker disponible
                const firstBookmaker = Object.keys(preMatchOdds)[0];
                if (firstBookmaker) {
                    const flatOdds = {};
                    for (const [betType, values] of Object.entries(preMatchOdds[firstBookmaker])) {
                        for (const [outcome, odd] of Object.entries(values)) {
                            flatOdds[outcome] = odd;
                            flatOdds[`${betType} - ${outcome}`] = odd;
                        }
                    }
                    
                    console.log(`⚠️ Using pre-match alternative: ${firstBookmaker}`);
                    return {
                        bookmaker: firstBookmaker,
                        odds: flatOdds,
                        isLive: false,
                        source: 'pre-match-alternative',
                        allBookmakers: Object.keys(preMatchOdds)
                    };
                }
            }
            
            console.log('❌ No odds data available');
            return null;
        } catch (error) {
            console.error(`Error fetching live odds for ${bookmakerName}:`, error.message);
            return null;
        }
    }

    /**
     * Compare les cotes et détecte les changements
     */
    detectOddsChanges(originalOdds, currentOdds) {
        if (!originalOdds || !currentOdds) return null;

        const originalValue = parseFloat(originalOdds);
        const currentValue = parseFloat(currentOdds);

        if (isNaN(originalValue) || isNaN(currentValue)) return null;

        const difference = currentValue - originalValue;
        const percentageChange = ((difference / originalValue) * 100).toFixed(1);

        return {
            original: originalValue,
            current: currentValue,
            difference: parseFloat(difference.toFixed(2)),
            percentageChange: parseFloat(percentageChange),
            direction: difference > 0.02 ? 'up' : difference < -0.02 ? 'down' : 'stable',
            isSignificant: Math.abs(difference) > 0.05 // Seuil réduit pour détecter plus de changements
        };
    }

    /**
     * Recalcule la mise optimale avec les nouvelles cotes (Kelly)
     */
    recalculateStake(probability, newOdds, totalCapital, maxPercentage = 0.06) {
        if (!probability || !newOdds || !totalCapital) return null;

        const p = probability / 100; // Convertir en décimal
        const b = newOdds - 1;
        const q = 1 - p;

        // Kelly: f* = (bp - q) / b
        let kellyFraction = Math.max(0, (b * p - q) / b);
        kellyFraction = Math.min(kellyFraction, maxPercentage);

        const stake = Math.round(totalCapital * kellyFraction);
        
        return {
            recommendedStake: stake,
            kellyPercentage: Math.round(kellyFraction * 100 * 10) / 10,
            potentialReturn: Math.round(stake * newOdds),
            potentialProfit: Math.round(stake * (newOdds - 1))
        };
    }

    /**
     * Simule l'évolution des cotes basée sur le score actuel et le temps
     * Utilisé quand les cotes live ne sont pas disponibles via l'API
     */
    simulateOddsEvolution(optionName, originalOdds, matchStatus) {
        const option = (optionName || '').toLowerCase();
        const score = matchStatus.score || { home: 0, away: 0 };
        const elapsed = matchStatus.elapsed || 0;
        const homeGoals = score.home || 0;
        const awayGoals = score.away || 0;
        
        let adjustment = 0;
        
        // Victoire domicile
        if (option.includes('victoire') && !option.includes('extérieur') && !option.includes('double')) {
            if (homeGoals > awayGoals) {
                // Mène → cote baisse (plus probable)
                adjustment = -0.15 * (homeGoals - awayGoals) - (elapsed / 90) * 0.2;
            } else if (homeGoals < awayGoals) {
                // Perd → cote monte (moins probable)
                adjustment = 0.25 * (awayGoals - homeGoals) + (elapsed / 90) * 0.15;
            } else {
                // Match nul → légère hausse avec le temps
                adjustment = (elapsed / 90) * 0.1;
            }
        }
        
        // Victoire extérieur
        if (option.includes('victoire') && option.includes('extérieur')) {
            if (awayGoals > homeGoals) {
                adjustment = -0.15 * (awayGoals - homeGoals) - (elapsed / 90) * 0.2;
            } else if (awayGoals < homeGoals) {
                adjustment = 0.25 * (homeGoals - awayGoals) + (elapsed / 90) * 0.15;
            } else {
                adjustment = (elapsed / 90) * 0.1;
            }
        }
        
        // Match nul
        if (option.includes('nul') || option.includes('draw')) {
            if (homeGoals === awayGoals) {
                // Score nul → cote baisse avec le temps
                adjustment = -(elapsed / 90) * 0.3;
            } else {
                // Score non nul → cote monte
                adjustment = 0.3 * Math.abs(homeGoals - awayGoals) + (elapsed / 90) * 0.2;
            }
        }
        
        // Asian Handicap
        if (option.includes('asian handicap') || option.includes('handicap')) {
            const handicapMatch = option.match(/([+-]?\d+\.?\d*)/);
            if (handicapMatch) {
                const handicap = parseFloat(handicapMatch[1]);
                const effectiveScore = option.includes('home') 
                    ? homeGoals - awayGoals + handicap
                    : awayGoals - homeGoals - handicap;
                
                if (effectiveScore > 0) {
                    adjustment = -0.1 - (elapsed / 90) * 0.1;
                } else if (effectiveScore < 0) {
                    adjustment = 0.15 + (elapsed / 90) * 0.1;
                }
            }
        }
        
        // Over/Under
        const totalGoals = homeGoals + awayGoals;
        const overMatch = option.match(/plus de (\d+\.?\d*)/i);
        if (overMatch) {
            const threshold = parseFloat(overMatch[1]);
            if (totalGoals > threshold) {
                adjustment = -originalOdds + 1.01; // Presque gagné
            } else {
                const goalsNeeded = Math.ceil(threshold) - totalGoals + 1;
                adjustment = goalsNeeded > 2 ? 0.3 : goalsNeeded > 1 ? 0.15 : -0.1;
                adjustment += (1 - (90 - elapsed) / 90) * 0.1;
            }
        }
        
        const underMatch = option.match(/moins de (\d+\.?\d*)/i);
        if (underMatch) {
            const threshold = parseFloat(underMatch[1]);
            if (totalGoals >= Math.ceil(threshold)) {
                adjustment = originalOdds + 5; // Perdu
            } else {
                adjustment = -(elapsed / 90) * 0.25; // Plus probable avec le temps
            }
        }
        
        // BTTS
        if (option.includes('btts') || option.includes('deux équipes marquent')) {
            const bothScored = homeGoals > 0 && awayGoals > 0;
            if (option.includes('oui') || option.includes('yes')) {
                if (bothScored) {
                    adjustment = -originalOdds + 1.01; // Gagné
                } else if (homeGoals > 0 || awayGoals > 0) {
                    adjustment = -0.2;
                } else {
                    adjustment = (elapsed / 90) * 0.2;
                }
            } else {
                if (bothScored) {
                    adjustment = originalOdds + 5; // Perdu
                } else {
                    adjustment = -(elapsed / 90) * 0.2;
                }
            }
        }
        
        // Appliquer l'ajustement
        let newOdds = originalOdds + adjustment;
        
        // Limiter les cotes entre 1.01 et 50
        newOdds = Math.max(1.01, Math.min(50, newOdds));
        
        // Arrondir à 2 décimales
        return Math.round(newOdds * 100) / 100;
    }

    /**
     * Trouve la cote live correspondant à une option de pari
     * Mapping intelligent entre les noms d'options français et les données API
     */
    findLiveOddsForOption(optionName, originalOdds, liveOddsData, matchStatus) {
        if (!liveOddsData?.odds || !optionName) {
            return originalOdds;
        }

        const option = optionName.toLowerCase();
        const allOdds = liveOddsData.odds;
        
        // Log pour debug
        console.log(`🔍 Searching live odds for: "${optionName}"`);
        console.log(`📊 Available odds keys:`, Object.keys(allOdds));

        // === MATCH WINNER / 1X2 ===
        if (option.includes('victoire') && !option.includes('extérieur') && !option.includes('double')) {
            // Victoire domicile
            const homeOdds = allOdds['Home'] || allOdds['1'] || allOdds['home'] || allOdds['Win 1'];
            if (homeOdds) return parseFloat(homeOdds);
        }
        
        if (option.includes('victoire') && option.includes('extérieur')) {
            // Victoire extérieur
            const awayOdds = allOdds['Away'] || allOdds['2'] || allOdds['away'] || allOdds['Win 2'];
            if (awayOdds) return parseFloat(awayOdds);
        }
        
        if (option.includes('nul') || option.includes('match nul') || option.includes('draw')) {
            const drawOdds = allOdds['Draw'] || allOdds['X'] || allOdds['draw'];
            if (drawOdds) return parseFloat(drawOdds);
        }

        // === DOUBLE CHANCE ===
        if (option.includes('double chance')) {
            if (option.includes('1x') || (option.includes('domicile') && option.includes('nul'))) {
                const dc1x = allOdds['Home or Draw'] || allOdds['1X'] || allOdds['home_draw'];
                if (dc1x) return parseFloat(dc1x);
            }
            if (option.includes('x2') || (option.includes('extérieur') && option.includes('nul')) || option.includes('away or draw')) {
                const dcx2 = allOdds['Draw or Away'] || allOdds['Away or Draw'] || allOdds['X2'] || allOdds['draw_away'];
                if (dcx2) return parseFloat(dcx2);
            }
            if (option.includes('12') || option.includes('1 ou 2')) {
                const dc12 = allOdds['Home or Away'] || allOdds['12'] || allOdds['home_away'];
                if (dc12) return parseFloat(dc12);
            }
        }

        // === ASIAN HANDICAP ===
        const asianMatch = option.match(/asian\s*handicap\s*(home|away)?\s*([+-]?\d+\.?\d*)/i);
        if (asianMatch) {
            const team = asianMatch[1]?.toLowerCase() || 'home';
            const handicap = asianMatch[2];
            
            // Chercher la cote correspondante
            for (const [key, value] of Object.entries(allOdds)) {
                const keyLower = key.toLowerCase();
                if (keyLower.includes('handicap') || keyLower.includes('asian')) {
                    if (keyLower.includes(handicap) || key.includes(handicap)) {
                        if ((team === 'home' && (keyLower.includes('home') || keyLower.includes('1'))) ||
                            (team === 'away' && (keyLower.includes('away') || keyLower.includes('2')))) {
                            return parseFloat(value);
                        }
                    }
                }
            }
            
            // Fallback: chercher juste le handicap
            const handicapKey = `Home ${handicap}` || `Away ${handicap}`;
            if (allOdds[handicapKey]) return parseFloat(allOdds[handicapKey]);
        }

        // === OVER/UNDER (Plus de / Moins de) ===
        const overMatch = option.match(/plus de (\d+\.?\d*)/i);
        if (overMatch) {
            const threshold = overMatch[1];
            const overKey = `Over ${threshold}` || `over ${threshold}` || `Over${threshold}`;
            if (allOdds[overKey]) return parseFloat(allOdds[overKey]);
            
            // Chercher parmi toutes les clés
            for (const [key, value] of Object.entries(allOdds)) {
                if (key.toLowerCase().includes('over') && key.includes(threshold)) {
                    return parseFloat(value);
                }
            }
        }

        const underMatch = option.match(/moins de (\d+\.?\d*)/i);
        if (underMatch) {
            const threshold = underMatch[1];
            const underKey = `Under ${threshold}` || `under ${threshold}`;
            if (allOdds[underKey]) return parseFloat(allOdds[underKey]);
            
            for (const [key, value] of Object.entries(allOdds)) {
                if (key.toLowerCase().includes('under') && key.includes(threshold)) {
                    return parseFloat(value);
                }
            }
        }

        // === BTTS (Both Teams To Score) ===
        if (option.includes('btts') || option.includes('deux équipes marquent') || option.includes('les deux équipes marquent')) {
            if (option.includes('oui') || option.includes('yes')) {
                const bttsYes = allOdds['Yes'] || allOdds['BTTS Yes'] || allOdds['btts_yes'];
                if (bttsYes) return parseFloat(bttsYes);
            } else if (option.includes('non') || option.includes('no')) {
                const bttsNo = allOdds['No'] || allOdds['BTTS No'] || allOdds['btts_no'];
                if (bttsNo) return parseFloat(bttsNo);
            }
        }

        // === CORRECT SCORE ===
        const scoreMatch = option.match(/score exact?\s*:?\s*(\d+)\s*-\s*(\d+)/i);
        if (scoreMatch) {
            const score = `${scoreMatch[1]}-${scoreMatch[2]}`;
            if (allOdds[score]) return parseFloat(allOdds[score]);
            if (allOdds[`${scoreMatch[1]}:${scoreMatch[2]}`]) return parseFloat(allOdds[`${scoreMatch[1]}:${scoreMatch[2]}`]);
        }

        // === MI-TEMPS / FULL TIME ===
        if (option.includes('mi-temps') || option.includes('halftime')) {
            // Logique pour HT/FT à ajouter si nécessaire
        }

        // Si aucune correspondance trouvée, retourner la cote originale
        console.log(`⚠️ No live odds match found for "${optionName}", using original: ${originalOdds}`);
        return originalOdds;
    }

    /**
     * Calcule les cotes pour les stratégies de couverture (hedging)
     */
    calculateHedgingOdds(liveOddsData, matchStatus, selectedOptions) {
        const hedgingOdds = {
            doubleChance: {},
            matchWinner: {},
            overUnder: {},
            updatedAt: new Date().toISOString()
        };

        if (!liveOddsData?.odds) {
            console.log('⚠️ No live odds data for hedging calculations');
            return hedgingOdds;
        }

        const allOdds = liveOddsData.odds;

        // Match Winner
        hedgingOdds.matchWinner = {
            home: parseFloat(allOdds['Home'] || allOdds['1']) || null,
            draw: parseFloat(allOdds['Draw'] || allOdds['X']) || null,
            away: parseFloat(allOdds['Away'] || allOdds['2']) || null
        };

        // Double Chance
        hedgingOdds.doubleChance = {
            homeOrDraw: parseFloat(allOdds['Home or Draw'] || allOdds['1X']) || null,
            awayOrDraw: parseFloat(allOdds['Draw or Away'] || allOdds['Away or Draw'] || allOdds['X2']) || null,
            homeOrAway: parseFloat(allOdds['Home or Away'] || allOdds['12']) || null
        };

        // Over/Under
        for (const threshold of ['0.5', '1.5', '2.5', '3.5', '4.5']) {
            const overKey = Object.keys(allOdds).find(k => k.toLowerCase().includes('over') && k.includes(threshold));
            const underKey = Object.keys(allOdds).find(k => k.toLowerCase().includes('under') && k.includes(threshold));
            
            if (overKey || underKey) {
                hedgingOdds.overUnder[threshold] = {
                    over: overKey ? parseFloat(allOdds[overKey]) : null,
                    under: underKey ? parseFloat(allOdds[underKey]) : null
                };
            }
        }

        // Calculer les cotes de couverture recommandées basées sur les options sélectionnées
        hedgingOdds.recommendedHedges = [];
        
        selectedOptions.forEach(opt => {
            const option = (opt.option || '').toLowerCase();
            
            // Si pari sur victoire domicile → couverture = X2 (Draw or Away)
            if (option.includes('victoire') && !option.includes('extérieur') && !option.includes('double')) {
                if (hedgingOdds.doubleChance.awayOrDraw) {
                    hedgingOdds.recommendedHedges.push({
                        originalBet: opt.option,
                        hedgeBet: 'Double Chance (Away or Draw)',
                        hedgeBetKey: 'X2',
                        currentOdds: hedgingOdds.doubleChance.awayOrDraw,
                        type: 'double_chance'
                    });
                }
            }
            
            // Si pari sur victoire extérieur → couverture = 1X (Home or Draw)
            if (option.includes('victoire') && option.includes('extérieur')) {
                if (hedgingOdds.doubleChance.homeOrDraw) {
                    hedgingOdds.recommendedHedges.push({
                        originalBet: opt.option,
                        hedgeBet: 'Double Chance (Home or Draw)',
                        hedgeBetKey: '1X',
                        currentOdds: hedgingOdds.doubleChance.homeOrDraw,
                        type: 'double_chance'
                    });
                }
            }
            
            // Si pari sur nul → couverture = 12 (Home or Away)
            if (option.includes('nul') || option.includes('draw')) {
                if (hedgingOdds.doubleChance.homeOrAway) {
                    hedgingOdds.recommendedHedges.push({
                        originalBet: opt.option,
                        hedgeBet: 'Double Chance (Home or Away)',
                        hedgeBetKey: '12',
                        currentOdds: hedgingOdds.doubleChance.homeOrAway,
                        type: 'double_chance'
                    });
                }
            }

            // Si pari Asian Handicap Home → couverture potentielle
            if (option.includes('asian handicap') && option.includes('home')) {
                if (hedgingOdds.doubleChance.awayOrDraw) {
                    hedgingOdds.recommendedHedges.push({
                        originalBet: opt.option,
                        hedgeBet: 'Double Chance (Away or Draw)',
                        hedgeBetKey: 'X2',
                        currentOdds: hedgingOdds.doubleChance.awayOrDraw,
                        type: 'double_chance'
                    });
                }
            }

            // Over/Under hedging
            const overMatch = option.match(/plus de (\d+\.?\d*)/i);
            if (overMatch) {
                const threshold = overMatch[1];
                if (hedgingOdds.overUnder[threshold]?.under) {
                    hedgingOdds.recommendedHedges.push({
                        originalBet: opt.option,
                        hedgeBet: `Moins de ${threshold} buts`,
                        hedgeBetKey: `Under ${threshold}`,
                        currentOdds: hedgingOdds.overUnder[threshold].under,
                        type: 'over_under'
                    });
                }
            }

            const underMatch = option.match(/moins de (\d+\.?\d*)/i);
            if (underMatch) {
                const threshold = underMatch[1];
                if (hedgingOdds.overUnder[threshold]?.over) {
                    hedgingOdds.recommendedHedges.push({
                        originalBet: opt.option,
                        hedgeBet: `Plus de ${threshold} buts`,
                        hedgeBetKey: `Over ${threshold}`,
                        currentOdds: hedgingOdds.overUnder[threshold].over,
                        type: 'over_under'
                    });
                }
            }
        });

        console.log('📊 Hedging odds calculated:', hedgingOdds);
        return hedgingOdds;
    }

    /**
     * Suivi complet en temps réel d'une prédiction
     * Retourne toutes les données nécessaires pour le frontend
     */
    async getFullLiveTracking(fixtureId, selectedOptions, bookmakerName, userCapital = 10000, maxPercentage = 0.06) {
        console.log(`🔴 Full live tracking for fixture ${fixtureId}, bookmaker: ${bookmakerName}`);

        try {
            // Récupérer toutes les données en parallèle
            const [matchStatus, liveOdds, events, statistics] = await Promise.allSettled([
                this.getMatchStatus(fixtureId),
                this.getLiveOddsForBookmaker(fixtureId, bookmakerName),
                this.getLiveEvents(fixtureId),
                this.getLiveMatchStatistics(fixtureId)
            ]);

            const status = matchStatus.status === 'fulfilled' ? matchStatus.value : null;
            const odds = liveOdds.status === 'fulfilled' ? liveOdds.value : null;
            const matchEvents = events.status === 'fulfilled' ? events.value : [];
            const stats = statistics.status === 'fulfilled' ? statistics.value : null;

            if (!status) {
                return {
                    error: 'match_not_found',
                    message: 'Données du match non disponibles'
                };
            }

            // Filtrer les événements importants (derniers 10 min ou tous si peu)
            const importantEvents = matchEvents
                .filter(e => ['Goal', 'Card', 'subst', 'Penalty', 'Var'].includes(e.type))
                .slice(-10);

            // Log des cotes disponibles
            console.log(`📊 Live odds available: ${odds ? 'YES' : 'NO'}`, odds?.odds ? Object.keys(odds.odds).slice(0, 5) : 'none');

            // Évaluer chaque option avec les cotes live
            const evaluatedOptions = selectedOptions.map(opt => {
                const originalOdds = opt.odds || opt.originalOdds || 1.5;
                
                // Trouver la cote live correspondante avec mapping amélioré
                let currentOdds = this.findLiveOddsForOption(opt.option, originalOdds, odds, status);
                
                // Si pas de cote live trouvée, simuler l'évolution basée sur le match
                if (currentOdds === originalOdds && odds === null && status.hasStarted) {
                    currentOdds = this.simulateOddsEvolution(opt.option, originalOdds, status);
                }
                
                // S'assurer que currentOdds est un nombre valide
                currentOdds = parseFloat(currentOdds) || originalOdds;

                // Calculer la probabilité dynamique
                const dynamicProb = this.calculateDynamicProbability(
                    opt.option,
                    status.score,
                    status.elapsed,
                    originalOdds,
                    currentOdds
                );

                // Détecter les changements de cotes
                const oddsChange = this.detectOddsChanges(originalOdds, currentOdds);

                // Recalculer la mise avec les nouvelles cotes
                const newStakeCalc = this.recalculateStake(
                    dynamicProb.probability,
                    currentOdds,
                    userCapital,
                    maxPercentage
                );

                // Évaluer le statut actuel du pari
                const evaluation = this.evaluateBetOption(
                    opt.option,
                    status.score,
                    status.status,
                    currentOdds
                );

                return {
                    ...opt,
                    originalOdds,
                    currentOdds,
                    oddsChange,
                    dynamicProbability: dynamicProb.probability,
                    probabilityTrend: dynamicProb.trend,
                    probabilityConfidence: dynamicProb.confidence,
                    currentStatus: evaluation.status,
                    staticProbability: Math.round(evaluation.probability * 100),
                    suggestedStake: newStakeCalc,
                    stake: opt.stake || opt.adjustedStake || 0
                };
            });

            // Calculer les cotes pour les stratégies de couverture (Double Chance, etc.)
            const hedgingOdds = this.calculateHedgingOdds(odds, status, selectedOptions);

            // Calculer le statut global de la prédiction
            const globalStatus = this.calculateGlobalPredictionStatus(evaluatedOptions);

            return {
                matchStatus: status,
                liveOdds: odds,
                hedgingOdds, // Nouvelles cotes pour les paris de couverture
                events: importantEvents,
                statistics: stats,
                options: evaluatedOptions,
                globalStatus,
                canHedge: status.canHedge,
                fetchedAt: new Date().toISOString()
            };

        } catch (error) {
            console.error('Error in full live tracking:', error);
            return {
                error: 'tracking_failed',
                message: error.message
            };
        }
    }

    /**
     * Calcule le statut global de la prédiction
     */
    calculateGlobalPredictionStatus(evaluatedOptions) {
        if (!evaluatedOptions || evaluatedOptions.length === 0) {
            return { status: 'unknown', message: 'Pas d\'options' };
        }

        const won = evaluatedOptions.filter(o => o.currentStatus === 'won').length;
        const lost = evaluatedOptions.filter(o => o.currentStatus === 'lost').length;
        const winning = evaluatedOptions.filter(o => o.currentStatus === 'winning').length;
        const losing = evaluatedOptions.filter(o => o.currentStatus === 'losing').length;
        const pending = evaluatedOptions.filter(o => o.currentStatus === 'pending').length;

        const total = evaluatedOptions.length;
        const avgProbability = Math.round(
            evaluatedOptions.reduce((sum, o) => sum + (o.dynamicProbability || 50), 0) / total
        );

        let status = 'pending';
        let emoji = '⏳';
        let message = '';

        if (won === total) {
            status = 'won';
            emoji = '🎉';
            message = 'Tous les paris gagnés!';
        } else if (lost === total) {
            status = 'lost';
            emoji = '😔';
            message = 'Tous les paris perdus';
        } else if (lost > 0) {
            status = 'partial_loss';
            emoji = '⚠️';
            message = `${lost}/${total} paris perdus`;
        } else if (won > 0 && pending > 0) {
            status = 'partial_win';
            emoji = '✅';
            message = `${won}/${total} validés, ${pending} en cours`;
        } else if (winning > losing) {
            status = 'favorable';
            emoji = '📈';
            message = `Situation favorable (${avgProbability}% de réussite)`;
        } else if (losing > winning) {
            status = 'unfavorable';
            emoji = '📉';
            message = `Situation défavorable (${avgProbability}% de réussite)`;
        } else {
            status = 'neutral';
            emoji = '⏳';
            message = `En attente (${avgProbability}% de réussite)`;
        }

        return {
            status,
            emoji,
            message,
            won,
            lost,
            winning,
            losing,
            pending,
            avgProbability,
            total
        };
    }

    /**
     * Trouve la cote live correspondant à une option de pari
     * Avec simulation si cotes live non disponibles
     */
    findLiveOddsForOption(optionName, originalOdds, liveOddsData, matchStatus) {
        const optLower = (optionName || '').toLowerCase();
        const score = matchStatus?.score || { home: 0, away: 0 };
        const elapsed = matchStatus?.elapsed || 0;
        const timeProgress = elapsed / 90;
        
        // Si on a des cotes live, essayer de mapper
        if (liveOddsData?.odds) {
            const odds = liveOddsData.odds;
            
            // Asian Handicap
            if (optLower.includes('asian handicap') || optLower.includes('handicap asiatique')) {
                const handicapMatch = optLower.match(/([-+]?\d+\.?\d*)/);
                if (handicapMatch) {
                    const handicap = parseFloat(handicapMatch[1]);
                    const key = optLower.includes('home') ? `AH Home ${handicap}` : `AH Away ${handicap}`;
                    if (odds[key]) return parseFloat(odds[key]);
                }
            }
            
            // 1X2 / Match Winner
            if (optLower.includes('victoire') && !optLower.includes('extérieur') && !optLower.includes('away')) {
                return parseFloat(odds['Home'] || odds['1'] || odds['Match Winner Home']) || originalOdds;
            }
            if (optLower.includes('victoire') && (optLower.includes('extérieur') || optLower.includes('away'))) {
                return parseFloat(odds['Away'] || odds['2'] || odds['Match Winner Away']) || originalOdds;
            }
            if (optLower.includes('nul') || optLower.includes('draw')) {
                return parseFloat(odds['Draw'] || odds['X'] || odds['Match Winner Draw']) || originalOdds;
            }
            
            // Double Chance
            if (optLower.includes('double chance') || optLower.includes('1x')) {
                if (optLower.includes('1x') || (optLower.includes('home') && optLower.includes('draw'))) {
                    return parseFloat(odds['1X'] || odds['Double Chance 1X'] || odds['Home or Draw']) || originalOdds;
                }
                if (optLower.includes('x2') || (optLower.includes('away') && optLower.includes('draw'))) {
                    return parseFloat(odds['X2'] || odds['Double Chance X2'] || odds['Away or Draw']) || originalOdds;
                }
                if (optLower.includes('12') || optLower.includes('home') && optLower.includes('away')) {
                    return parseFloat(odds['12'] || odds['Double Chance 12'] || odds['Home or Away']) || originalOdds;
                }
            }
            
            // Over/Under
            const overMatch = optLower.match(/plus de (\d+\.?\d*)|over (\d+\.?\d*)/i);
            if (overMatch) {
                const threshold = overMatch[1] || overMatch[2];
                return parseFloat(odds[`Over ${threshold}`] || odds[`O${threshold}`]) || originalOdds;
            }
            const underMatch = optLower.match(/moins de (\d+\.?\d*)|under (\d+\.?\d*)/i);
            if (underMatch) {
                const threshold = underMatch[1] || underMatch[2];
                return parseFloat(odds[`Under ${threshold}`] || odds[`U${threshold}`]) || originalOdds;
            }
            
            // BTTS
            if (optLower.includes('btts') || optLower.includes('deux équipes marquent')) {
                if (optLower.includes('oui') || optLower.includes('yes')) {
                    return parseFloat(odds['BTTS Yes'] || odds['Yes'] || odds['Both Teams Score Yes']) || originalOdds;
                } else {
                    return parseFloat(odds['BTTS No'] || odds['No'] || odds['Both Teams Score No']) || originalOdds;
                }
            }
        }
        
        // SIMULATION: Si pas de cotes live, simuler l'évolution basée sur le match
        return this.simulateOddsEvolution(optionName, originalOdds, score, elapsed);
    }
    
    /**
     * Simule l'évolution des cotes basée sur le score et le temps
     */
    simulateOddsEvolution(optionName, originalOdds, score, elapsed) {
        const optLower = (optionName || '').toLowerCase();
        const homeGoals = score.home || 0;
        const awayGoals = score.away || 0;
        const totalGoals = homeGoals + awayGoals;
        const timeProgress = elapsed / 90;
        
        let adjustmentFactor = 1;
        
        // Victoire domicile
        if (optLower.includes('victoire') && !optLower.includes('extérieur') && !optLower.includes('away')) {
            if (homeGoals > awayGoals) {
                // Équipe domicile mène - cote baisse
                adjustmentFactor = 0.6 - (timeProgress * 0.3) - ((homeGoals - awayGoals) * 0.1);
            } else if (homeGoals < awayGoals) {
                // Équipe domicile menée - cote monte
                adjustmentFactor = 1.5 + (timeProgress * 0.5) + ((awayGoals - homeGoals) * 0.2);
            } else {
                // Match nul - légère hausse avec le temps
                adjustmentFactor = 1 + (timeProgress * 0.2);
            }
        }
        
        // Victoire extérieur
        if (optLower.includes('victoire') && (optLower.includes('extérieur') || optLower.includes('away'))) {
            if (awayGoals > homeGoals) {
                adjustmentFactor = 0.6 - (timeProgress * 0.3) - ((awayGoals - homeGoals) * 0.1);
            } else if (awayGoals < homeGoals) {
                adjustmentFactor = 1.5 + (timeProgress * 0.5) + ((homeGoals - awayGoals) * 0.2);
            } else {
                adjustmentFactor = 1 + (timeProgress * 0.2);
            }
        }
        
        // Match nul
        if (optLower.includes('nul') || optLower.includes('draw')) {
            if (homeGoals === awayGoals) {
                // Nul actuel - cote baisse avec le temps
                adjustmentFactor = 0.8 - (timeProgress * 0.4);
            } else {
                // Pas nul - cote monte beaucoup
                adjustmentFactor = 2 + (timeProgress * 1) + (Math.abs(homeGoals - awayGoals) * 0.5);
            }
        }
        
        // Asian Handicap
        if (optLower.includes('asian handicap') || optLower.includes('handicap')) {
            const handicapMatch = optLower.match(/([-+]?\d+\.?\d*)/);
            if (handicapMatch) {
                const handicap = parseFloat(handicapMatch[1]);
                const isHome = optLower.includes('home');
                const adjustedScore = isHome ? (homeGoals + handicap - awayGoals) : (awayGoals + handicap - homeGoals);
                
                if (adjustedScore > 0) {
                    adjustmentFactor = 0.7 - (timeProgress * 0.3);
                } else if (adjustedScore < 0) {
                    adjustmentFactor = 1.5 + (timeProgress * 0.5);
                } else {
                    adjustmentFactor = 1;
                }
            }
        }
        
        // Over/Under
        const overMatch = optLower.match(/plus de (\d+\.?\d*)|over (\d+\.?\d*)/i);
        if (overMatch) {
            const threshold = parseFloat(overMatch[1] || overMatch[2]);
            if (totalGoals > threshold) {
                adjustmentFactor = 0.1; // Déjà validé - cote très basse
            } else {
                const goalsNeeded = Math.ceil(threshold) - totalGoals + 1;
                adjustmentFactor = 1 + (timeProgress * goalsNeeded * 0.3);
            }
        }
        
        const underMatch = optLower.match(/moins de (\d+\.?\d*)|under (\d+\.?\d*)/i);
        if (underMatch) {
            const threshold = parseFloat(underMatch[1] || underMatch[2]);
            if (totalGoals >= threshold) {
                adjustmentFactor = 10; // Déjà perdu - cote très haute
            } else {
                adjustmentFactor = 0.8 - (timeProgress * 0.3);
            }
        }
        
        // BTTS
        if (optLower.includes('btts') || optLower.includes('deux équipes marquent')) {
            const bothScored = homeGoals > 0 && awayGoals > 0;
            const bttsYes = optLower.includes('oui') || optLower.includes('yes');
            
            if (bttsYes) {
                if (bothScored) {
                    adjustmentFactor = 0.1; // Validé
                } else if (homeGoals > 0 || awayGoals > 0) {
                    adjustmentFactor = 0.8 - (timeProgress * 0.2);
                } else {
                    adjustmentFactor = 1 + (timeProgress * 0.5);
                }
            } else {
                if (bothScored) {
                    adjustmentFactor = 10; // Perdu
                } else {
                    adjustmentFactor = 0.7 - (timeProgress * 0.3);
                }
            }
        }
        
        // Appliquer le facteur avec limites raisonnables
        adjustmentFactor = Math.max(0.1, Math.min(10, adjustmentFactor));
        const newOdds = Math.round(originalOdds * adjustmentFactor * 100) / 100;
        
        // Limiter entre 1.01 et 50
        return Math.max(1.01, Math.min(50, newOdds));
    }
    
    /**
     * Calcule les cotes pour les paris de couverture (Double Chance, etc.)
     */
    calculateHedgingOdds(liveOddsData, matchStatus, selectedOptions) {
        const score = matchStatus?.score || { home: 0, away: 0 };
        const elapsed = matchStatus?.elapsed || 0;
        const odds = liveOddsData?.odds || {};
        
        // Base: utiliser les cotes live si disponibles, sinon simuler
        const hedgingOptions = {
            // Double Chance
            'Double Chance 1X': this.getOrSimulateOdds(odds, ['1X', 'Double Chance 1X', 'Home or Draw'], 1.35, score, elapsed, 'dc_1x'),
            'Double Chance X2': this.getOrSimulateOdds(odds, ['X2', 'Double Chance X2', 'Away or Draw'], 1.45, score, elapsed, 'dc_x2'),
            'Double Chance 12': this.getOrSimulateOdds(odds, ['12', 'Double Chance 12', 'Home or Away'], 1.15, score, elapsed, 'dc_12'),
            
            // Over/Under courants
            'Over 0.5': this.getOrSimulateOdds(odds, ['Over 0.5', 'O0.5'], 1.10, score, elapsed, 'over_0.5'),
            'Over 1.5': this.getOrSimulateOdds(odds, ['Over 1.5', 'O1.5'], 1.35, score, elapsed, 'over_1.5'),
            'Over 2.5': this.getOrSimulateOdds(odds, ['Over 2.5', 'O2.5'], 1.85, score, elapsed, 'over_2.5'),
            'Under 2.5': this.getOrSimulateOdds(odds, ['Under 2.5', 'U2.5'], 1.95, score, elapsed, 'under_2.5'),
            'Under 3.5': this.getOrSimulateOdds(odds, ['Under 3.5', 'U3.5'], 1.30, score, elapsed, 'under_3.5'),
            
            // BTTS
            'BTTS Yes': this.getOrSimulateOdds(odds, ['BTTS Yes', 'Yes', 'Both Teams Score Yes'], 1.75, score, elapsed, 'btts_yes'),
            'BTTS No': this.getOrSimulateOdds(odds, ['BTTS No', 'No', 'Both Teams Score No'], 2.00, score, elapsed, 'btts_no'),
            
            // 1X2
            'Home': this.getOrSimulateOdds(odds, ['Home', '1', 'Match Winner Home'], 2.20, score, elapsed, 'home'),
            'Draw': this.getOrSimulateOdds(odds, ['Draw', 'X', 'Match Winner Draw'], 3.30, score, elapsed, 'draw'),
            'Away': this.getOrSimulateOdds(odds, ['Away', '2', 'Match Winner Away'], 3.50, score, elapsed, 'away'),
        };
        
        return {
            odds: hedgingOptions,
            source: liveOddsData?.isLive ? 'live' : 'simulated',
            updatedAt: new Date().toISOString()
        };
    }
    
    /**
     * Helper: Récupère une cote live ou simule
     */
    getOrSimulateOdds(odds, keys, defaultOdds, score, elapsed, type) {
        // Chercher dans les cotes live
        for (const key of keys) {
            if (odds[key]) {
                return parseFloat(odds[key]);
            }
        }
        
        // Simuler basé sur le type et le score
        return this.simulateHedgingOdds(type, defaultOdds, score, elapsed);
    }
    
    /**
     * Simule les cotes de couverture
     */
    simulateHedgingOdds(type, defaultOdds, score, elapsed) {
        const homeGoals = score.home || 0;
        const awayGoals = score.away || 0;
        const totalGoals = homeGoals + awayGoals;
        const timeProgress = elapsed / 90;
        
        let factor = 1;
        
        switch(type) {
            case 'dc_1x': // Double Chance Home or Draw
                if (homeGoals > awayGoals) factor = 0.5 - (timeProgress * 0.2);
                else if (homeGoals === awayGoals) factor = 0.7 - (timeProgress * 0.2);
                else factor = 1.5 + (timeProgress * 0.5);
                break;
                
            case 'dc_x2': // Double Chance Away or Draw
                if (awayGoals > homeGoals) factor = 0.5 - (timeProgress * 0.2);
                else if (homeGoals === awayGoals) factor = 0.7 - (timeProgress * 0.2);
                else factor = 1.5 + (timeProgress * 0.5);
                break;
                
            case 'dc_12': // Double Chance Home or Away
                if (homeGoals !== awayGoals) factor = 0.6 - (timeProgress * 0.3);
                else factor = 1.2 + (timeProgress * 0.3);
                break;
                
            case 'over_0.5':
                if (totalGoals >= 1) factor = 0.1;
                else factor = 1 + (timeProgress * 2);
                break;
                
            case 'over_1.5':
                if (totalGoals >= 2) factor = 0.1;
                else if (totalGoals === 1) factor = 0.7 + (timeProgress * 0.5);
                else factor = 1 + (timeProgress * 1.5);
                break;
                
            case 'over_2.5':
                if (totalGoals >= 3) factor = 0.1;
                else if (totalGoals === 2) factor = 0.6 + (timeProgress * 0.4);
                else if (totalGoals === 1) factor = 0.9 + (timeProgress * 0.6);
                else factor = 1 + (timeProgress * 1);
                break;
                
            case 'under_2.5':
                if (totalGoals >= 3) factor = 10;
                else if (totalGoals === 2) factor = 1.5 + (timeProgress * 1);
                else factor = 0.6 - (timeProgress * 0.3);
                break;
                
            case 'under_3.5':
                if (totalGoals >= 4) factor = 10;
                else if (totalGoals === 3) factor = 1.5 + (timeProgress * 1);
                else factor = 0.7 - (timeProgress * 0.3);
                break;
                
            case 'btts_yes':
                const bothScored = homeGoals > 0 && awayGoals > 0;
                if (bothScored) factor = 0.1;
                else if (homeGoals > 0 || awayGoals > 0) factor = 0.7 - (timeProgress * 0.2);
                else factor = 1 + (timeProgress * 0.8);
                break;
                
            case 'btts_no':
                const bothScoredNo = homeGoals > 0 && awayGoals > 0;
                if (bothScoredNo) factor = 10;
                else factor = 0.6 - (timeProgress * 0.3);
                break;
                
            case 'home':
                if (homeGoals > awayGoals) factor = 0.5 - (timeProgress * 0.3);
                else if (homeGoals < awayGoals) factor = 2 + (timeProgress * 1);
                else factor = 1 + (timeProgress * 0.3);
                break;
                
            case 'draw':
                if (homeGoals === awayGoals) factor = 0.6 - (timeProgress * 0.4);
                else factor = 3 + (timeProgress * 2);
                break;
                
            case 'away':
                if (awayGoals > homeGoals) factor = 0.5 - (timeProgress * 0.3);
                else if (awayGoals < homeGoals) factor = 2 + (timeProgress * 1);
                else factor = 1 + (timeProgress * 0.3);
                break;
        }
        
        factor = Math.max(0.1, Math.min(10, factor));
        const result = Math.round(defaultOdds * factor * 100) / 100;
        return Math.max(1.01, Math.min(50, result));
    }
}

module.exports = { LiveFootballService };
