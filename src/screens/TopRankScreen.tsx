
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../hooks';

interface RankUser {
  id: string;
  username: string;
  avatar?: string;
  score: number;
  rank: number;
}

interface TopRankScreenProps {
  navigation: any;
}

export default function TopRankScreen({ navigation }: TopRankScreenProps) {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState<'games' | 'gifts' | 'wealth'>('games');
  const [gameRankings, setGameRankings] = useState<RankUser[]>([]);
  const [giftRankings, setGiftRankings] = useState<RankUser[]>([]);
  const [wealthRankings, setWealthRankings] = useState<RankUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const getApiUrl = () => {
    return 'https://2968a09a-ea9e-4400-aa61-da927ebc2b19-00-kk2da6734ef9.sisko.replit.dev';
  };

  const fetchRankings = async (type: string) => {
    try {
      setLoading(true);
      const response = await fetch(`${getApiUrl()}/api/rankings/${type}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        return data.rankings || [];
      } else {
        console.error(`Failed to fetch ${type} rankings`);
        return [];
      }
    } catch (error) {
      console.error(`Error fetching ${type} rankings:`, error);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const loadAllRankings = async () => {
    const [games, gifts, wealth] = await Promise.all([
      fetchRankings('games'),
      fetchRankings('gifts'),
      fetchRankings('wealth')
    ]);

    setGameRankings(games);
    setGiftRankings(gifts);
    setWealthRankings(wealth);
  };

  useEffect(() => {
    loadAllRankings();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAllRankings();
    setRefreshing(false);
  };

  const getCurrentRankings = () => {
    switch (activeTab) {
      case 'games':
        return gameRankings;
      case 'gifts':
        return giftRankings;
      case 'wealth':
        return wealthRankings;
      default:
        return [];
    }
  };

  const getScoreLabel = () => {
    switch (activeTab) {
      case 'games':
        return 'Game Score';
      case 'gifts':
        return 'Gifts Received';
      case 'wealth':
        return 'Total Credits';
      default:
        return 'Score';
    }
  };

  const formatScore = (score: number) => {
    if (activeTab === 'wealth') {
      return score.toLocaleString('id-ID');
    }
    return score.toString();
  };

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return '🥇';
      case 2:
        return '🥈';
      case 3:
        return '🥉';
      default:
        return `#${rank}`;
    }
  };

  const renderRankItem = (user: RankUser, index: number) => (
    <View key={user.id} style={[
      styles.rankItem,
      index < 3 && styles.topThreeItem
    ]}>
      <View style={styles.rankPosition}>
        <Text style={[
          styles.rankNumber,
          index < 3 && styles.topThreeRank
        ]}>
          {getRankIcon(user.rank)}
        </Text>
      </View>

      <View style={styles.userInfo}>
        <View style={styles.avatarContainer}>
          {user.avatar?.startsWith('http') ? (
            <Image source={{ uri: user.avatar }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: index < 3 ? '#FFD700' : '#9E9E9E' }]}>
              <Text style={styles.avatarText}>
                {user.avatar || user.username?.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.username}>{user.username}</Text>
      </View>

      <View style={styles.scoreContainer}>
        <Text style={[
          styles.score,
          index < 3 && styles.topThreeScore
        ]}>
          {formatScore(user.score)}
        </Text>
        <Text style={styles.scoreLabel}>{getScoreLabel()}</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={['#FFD700', '#FFA000']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.header}
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        
        <View style={styles.headerContent}>
          <Ionicons name="trophy" size={32} color="#fff" />
          <Text style={styles.headerTitle}>Top Rankings</Text>
        </View>

        <TouchableOpacity style={styles.refreshButton} onPress={onRefresh}>
          <Ionicons name="refresh" size={24} color="#fff" />
        </TouchableOpacity>
      </LinearGradient>

      {/* Tab Selector */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'games' && styles.activeTab]}
          onPress={() => setActiveTab('games')}
        >
          <Ionicons name="game-controller" size={20} color={activeTab === 'games' ? '#fff' : '#666'} />
          <Text style={[styles.tabText, activeTab === 'games' && styles.activeTabText]}>
            Games
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'gifts' && styles.activeTab]}
          onPress={() => setActiveTab('gifts')}
        >
          <Ionicons name="gift" size={20} color={activeTab === 'gifts' ? '#fff' : '#666'} />
          <Text style={[styles.tabText, activeTab === 'gifts' && styles.activeTabText]}>
            Gifts
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'wealth' && styles.activeTab]}
          onPress={() => setActiveTab('wealth')}
        >
          <Ionicons name="diamond" size={20} color={activeTab === 'wealth' ? '#fff' : '#666'} />
          <Text style={[styles.tabText, activeTab === 'wealth' && styles.activeTabText]}>
            Wealth
          </Text>
        </TouchableOpacity>
      </View>

      {/* Rankings List */}
      <ScrollView
        style={styles.rankingsList}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {getCurrentRankings().length > 0 ? (
          getCurrentRankings().map((user, index) => renderRankItem(user, index))
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="trophy-outline" size={60} color="#ccc" />
            <Text style={styles.emptyTitle}>No Rankings Available</Text>
            <Text style={styles.emptySubtitle}>
              Be the first to appear on the leaderboard!
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    paddingTop: 50,
    paddingBottom: 20,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    padding: 8,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginLeft: 12,
  },
  refreshButton: {
    padding: 8,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    margin: 16,
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#FFD700',
  },
  tabText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  activeTabText: {
    color: '#fff',
  },
  rankingsList: {
    flex: 1,
    paddingHorizontal: 16,
  },
  rankItem: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  topThreeItem: {
    borderWidth: 2,
    borderColor: '#FFD700',
  },
  rankPosition: {
    width: 50,
    alignItems: 'center',
  },
  rankNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#666',
  },
  topThreeRank: {
    fontSize: 24,
  },
  userInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  avatarContainer: {
    marginRight: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  scoreContainer: {
    alignItems: 'flex-end',
  },
  score: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  topThreeScore: {
    color: '#FFD700',
  },
  scoreLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#666',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
});
