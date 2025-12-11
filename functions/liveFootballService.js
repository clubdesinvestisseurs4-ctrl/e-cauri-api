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
}

module.exports = { LiveFootballService };
