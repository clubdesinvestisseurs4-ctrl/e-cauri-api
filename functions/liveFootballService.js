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
            const liveOdds = await this.getLiveOdds(fixtureId, bookmakerId);
            
            if (!liveOdds || liveOdds.length === 0) {
                // Fallback: essayer les cotes pré-match
                const preMatchOdds = await this.getPreMatchOdds(fixtureId);
                if (preMatchOdds && preMatchOdds[bookmakerName]) {
                    return {
                        bookmaker: bookmakerName,
                        odds: preMatchOdds[bookmakerName],
                        isLive: false,
                        source: 'pre-match'
                    };
                }
                return null;
            }

            // Chercher le bookmaker dans les cotes live
            for (const oddsData of liveOdds) {
                if (oddsData.bookmakers && oddsData.bookmakers[bookmakerName]) {
                    return {
                        bookmaker: bookmakerName,
                        odds: oddsData.bookmakers[bookmakerName],
                        isLive: true,
                        source: 'live',
                        update: oddsData.update
                    };
                }
            }

            // Si bookmaker spécifique non trouvé, retourner le premier disponible
            const firstBookmaker = Object.keys(liveOdds[0]?.bookmakers || {})[0];
            if (firstBookmaker) {
                return {
                    bookmaker: firstBookmaker,
                    odds: liveOdds[0].bookmakers[firstBookmaker],
                    isLive: true,
                    source: 'live-alternative',
                    update: liveOdds[0].update
                };
            }

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

        const changes = [];
        const originalValue = parseFloat(originalOdds);
        const currentValue = parseFloat(currentOdds);

        if (isNaN(originalValue) || isNaN(currentValue)) return null;

        const difference = currentValue - originalValue;
        const percentageChange = ((difference / originalValue) * 100).toFixed(1);

        return {
            original: originalValue,
            current: currentValue,
            difference: difference.toFixed(2),
            percentageChange: parseFloat(percentageChange),
            direction: difference > 0 ? 'up' : difference < 0 ? 'down' : 'stable',
            isSignificant: Math.abs(difference) > 0.1 // Changement significatif si > 0.1
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

            // Évaluer chaque option avec les cotes live
            const evaluatedOptions = selectedOptions.map(opt => {
                const originalOdds = opt.odds || opt.originalOdds;
                
                // Trouver la cote live correspondante (approximation par nom)
                let currentOdds = originalOdds;
                if (odds?.odds) {
                    // Chercher une correspondance dans les cotes live
                    const optLower = (opt.option || '').toLowerCase();
                    
                    // Mappings courants
                    if (optLower.includes('victoire') && !optLower.includes('extérieur')) {
                        currentOdds = odds.odds['Home'] || odds.odds['1'] || originalOdds;
                    } else if (optLower.includes('victoire') && optLower.includes('extérieur')) {
                        currentOdds = odds.odds['Away'] || odds.odds['2'] || originalOdds;
                    } else if (optLower.includes('nul')) {
                        currentOdds = odds.odds['Draw'] || odds.odds['X'] || originalOdds;
                    } else if (optLower.includes('btts') && optLower.includes('oui')) {
                        currentOdds = odds.odds['Yes'] || originalOdds;
                    } else if (optLower.includes('plus de 2.5')) {
                        currentOdds = odds.odds['Over 2.5'] || originalOdds;
                    } else if (optLower.includes('plus de 1.5')) {
                        currentOdds = odds.odds['Over 1.5'] || originalOdds;
                    }
                }

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

            // Calculer le statut global de la prédiction
            const globalStatus = this.calculateGlobalPredictionStatus(evaluatedOptions);

            return {
                matchStatus: status,
                liveOdds: odds,
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
}

module.exports = { LiveFootballService };
