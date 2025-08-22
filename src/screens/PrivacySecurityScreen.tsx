
import React from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ScrollView,
  Alert 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function PrivacySecurityScreen({ navigation }: any) {
  const handleChangePassword = () => {
    navigation.navigate('ChangePassword');
  };

  const handleChangePin = () => {
    navigation.navigate('ChangePin');
  };

  const SecurityItem = ({ 
    icon, 
    title, 
    description,
    onPress,
    iconColor = '#9C27B0'
  }: {
    icon: string;
    title: string;
    description?: string;
    onPress?: () => void;
    iconColor?: string;
  }) => (
    <TouchableOpacity style={styles.securityItem} onPress={onPress}>
      <View style={styles.securityItemLeft}>
        <View style={[styles.iconContainer, { backgroundColor: iconColor + '20' }]}>
          <Ionicons name={icon as any} size={24} color={iconColor} />
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.securityItemTitle}>{title}</Text>
          {description && (
            <Text style={styles.securityItemDescription}>{description}</Text>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#999" />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privasi & Keamanan</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Account Security Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Keamanan Akun</Text>
          <View style={styles.sectionContent}>
            <SecurityItem
              icon="key"
              title="Ubah Password"
              description="Perbarui password untuk keamanan akun"
              onPress={handleChangePassword}
              iconColor="#FF6B35"
            />
            
            <SecurityItem
              icon="keypad"
              title="Ubah PIN"
              description="Atur PIN untuk akses cepat"
              onPress={handleChangePin}
              iconColor="#4CAF50"
            />
          </View>
        </View>

        {/* Privacy Settings Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pengaturan Privasi</Text>
          <View style={styles.sectionContent}>
            <SecurityItem
              icon="eye"
              title="Visibilitas Profil"
              description="Kontrol siapa yang dapat melihat profil Anda"
              iconColor="#2196F3"
            />
            
            <SecurityItem
              icon="notifications"
              title="Notifikasi Privasi"
              description="Kelola notifikasi terkait privasi"
              iconColor="#9C27B0"
            />
            
            <SecurityItem
              icon="location"
              title="Berbagi Lokasi"
              description="Pengaturan berbagi lokasi"
              iconColor="#FF9800"
            />
          </View>
        </View>

        {/* Security Features Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Fitur Keamanan</Text>
          <View style={styles.sectionContent}>
            <SecurityItem
              icon="finger-print"
              title="Autentikasi Biometrik"
              description="Login dengan sidik jari atau Face ID"
              iconColor="#E91E63"
            />
            
            <SecurityItem
              icon="shield-checkmark"
              title="Verifikasi Dua Langkah"
              description="Tingkatkan keamanan dengan 2FA"
              iconColor="#00BCD4"
            />
            
            <SecurityItem
              icon="time"
              title="Sesi Aktif"
              description="Lihat dan kelola sesi login aktif"
              iconColor="#795548"
            />
          </View>
        </View>

        {/* Data & Privacy Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Data & Privasi</Text>
          <View style={styles.sectionContent}>
            <SecurityItem
              icon="download"
              title="Unduh Data Saya"
              description="Unduh salinan data pribadi Anda"
              iconColor="#607D8B"
            />
            
            <SecurityItem
              icon="trash"
              title="Hapus Akun"
              description="Hapus akun dan semua data permanen"
              iconColor="#F44336"
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  placeholder: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginLeft: 20,
    marginBottom: 10,
  },
  sectionContent: {
    backgroundColor: '#fff',
    marginHorizontal: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  securityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  securityItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  textContainer: {
    flex: 1,
  },
  securityItemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  securityItemDescription: {
    fontSize: 14,
    color: '#666',
  },
});
