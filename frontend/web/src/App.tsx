import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface VoteProposal {
  id: string;
  title: string;
  description: string;
  encryptedWeight: string;
  publicVoteCount: number;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedValue?: number;
  category: string;
  status: 'active' | 'completed';
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<VoteProposal[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newProposalData, setNewProposalData] = useState({ 
    title: "", 
    description: "", 
    weight: "",
    category: "general"
  });
  const [selectedProposal, setSelectedProposal] = useState<VoteProposal | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [activeTab, setActiveTab] = useState("proposals");
  const [stats, setStats] = useState({
    totalProposals: 0,
    activeProposals: 0,
    totalVotes: 0,
    avgWeight: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [contractAddress, setContractAddress] = useState("");

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const proposalsList: VoteProposal[] = [];
      let totalVotes = 0;
      let totalWeight = 0;
      let activeCount = 0;

      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          const proposal: VoteProposal = {
            id: businessId,
            title: businessData.name,
            description: businessData.description,
            encryptedWeight: businessId,
            publicVoteCount: Number(businessData.publicValue1) || 0,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            category: "vote",
            status: Date.now()/1000 - Number(businessData.timestamp) < 60 * 60 * 24 * 7 ? 'active' : 'completed'
          };
          
          proposalsList.push(proposal);
          totalVotes += proposal.publicVoteCount;
          if (proposal.status === 'active') activeCount++;
          if (proposal.isVerified) totalWeight += proposal.decryptedValue || 0;
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setProposals(proposalsList);
      setStats({
        totalProposals: proposalsList.length,
        activeProposals: activeCount,
        totalVotes,
        avgWeight: proposalsList.length > 0 ? totalWeight / proposalsList.length : 0
      });
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createProposal = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingProposal(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating proposal with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const weightValue = parseInt(newProposalData.weight) || 0;
      const businessId = `proposal-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, weightValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newProposalData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newProposalData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Proposal created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewProposalData({ title: "", description: "", weight: "", category: "general" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingProposal(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      await loadData();
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredProposals = proposals.filter(proposal => {
    const matchesSearch = proposal.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         proposal.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === "all" || proposal.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = [...new Set(proposals.map(p => p.category))];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🏠 業委會隱私投票</h1>
            <span>Confidential Homeowner Voting</span>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-prompt">
          <div className="welcome-card">
            <h2>歡迎使用隱私投票系統</h2>
            <p>基於 FHE 全同態加密技術，保護您的投票隱私</p>
            <div className="feature-grid">
              <div className="feature-item">
                <div className="feature-icon">🔐</div>
                <h4>權重加密</h4>
                <p>房產面積作為投票權重，全程加密處理</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon">📊</div>
                <h4>同態計票</h4>
                <p>加密數據上直接計算，保護投票隱私</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon">👥</div>
                <h4>社區自治</h4>
                <p>促進鄰里和諧，避免投票矛盾</p>
              </div>
            </div>
            <div className="connect-hint">
              <p>請連接錢包開始使用</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="encryption-animation">
          <div className="lock-icon">🔒</div>
          <div className="encryption-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
        <p>初始化 FHE 加密系統...</p>
        <p className="loading-note">正在加載同態加密組件</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加載投票系統...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <div className="logo">
            <h1>🏠 業委會隱私投票</h1>
            <span>FHE Protected Community Voting</span>
          </div>
          <nav className="main-nav">
            <button 
              className={`nav-btn ${activeTab === "proposals" ? "active" : ""}`}
              onClick={() => setActiveTab("proposals")}
            >
              提案列表
            </button>
            <button 
              className={`nav-btn ${activeTab === "stats" ? "active" : ""}`}
              onClick={() => setActiveTab("stats")}
            >
              數據統計
            </button>
            <button 
              className={`nav-btn ${activeTab === "about" ? "active" : ""}`}
              onClick={() => setActiveTab("about")}
            >
              系統介紹
            </button>
          </nav>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">
            測試連接
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + 新建提案
          </button>
          <ConnectButton />
        </div>
      </header>

      <main className="main-content">
        {activeTab === "proposals" && (
          <div className="proposals-tab">
            <div className="controls-row">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="搜索提案..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <span className="search-icon">🔍</span>
              </div>
              
              <select 
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="filter-select"
              >
                <option value="all">所有分類</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              
              <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
                {isRefreshing ? "刷新中..." : "🔄"}
              </button>
            </div>

            <div className="proposals-grid">
              {filteredProposals.map((proposal, index) => (
                <div 
                  key={proposal.id}
                  className={`proposal-card ${proposal.status}`}
                  onClick={() => setSelectedProposal(proposal)}
                >
                  <div className="card-header">
                    <h3>{proposal.title}</h3>
                    <span className={`status-badge ${proposal.status}`}>
                      {proposal.status === 'active' ? '進行中' : '已結束'}
                    </span>
                  </div>
                  <p className="proposal-desc">{proposal.description}</p>
                  <div className="card-footer">
                    <div className="vote-info">
                      <span>投票數: {proposal.publicVoteCount}</span>
                      {proposal.isVerified && (
                        <span>權重: {proposal.decryptedValue}</span>
                      )}
                    </div>
                    <div className="verification-status">
                      {proposal.isVerified ? '✅ 已驗證' : '🔒 加密中'}
                    </div>
                  </div>
                </div>
              ))}
              
              {filteredProposals.length === 0 && (
                <div className="empty-state">
                  <div className="empty-icon">📋</div>
                  <p>暫無提案</p>
                  <button 
                    className="create-btn" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    創建第一個提案
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "stats" && (
          <div className="stats-tab">
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-icon">📊</div>
                <div className="stat-content">
                  <h3>總提案數</h3>
                  <div className="stat-value">{stats.totalProposals}</div>
                </div>
              </div>
              
              <div className="stat-card">
                <div className="stat-icon">⏰</div>
                <div className="stat-content">
                  <h3>進行中</h3>
                  <div className="stat-value">{stats.activeProposals}</div>
                </div>
              </div>
              
              <div className="stat-card">
                <div className="stat-icon">🗳️</div>
                <div className="stat-content">
                  <h3>總投票數</h3>
                  <div className="stat-value">{stats.totalVotes}</div>
                </div>
              </div>
              
              <div className="stat-card">
                <div className="stat-icon">⚖️</div>
                <div className="stat-content">
                  <h3>平均權重</h3>
                  <div className="stat-value">{stats.avgWeight.toFixed(1)}</div>
                </div>
              </div>
            </div>

            <div className="chart-section">
              <h3>投票分佈</h3>
              <div className="vote-chart">
                {proposals.map((proposal, index) => (
                  <div key={proposal.id} className="chart-bar">
                    <div 
                      className="bar-fill" 
                      style={{ height: `${(proposal.publicVoteCount / Math.max(1, stats.totalVotes)) * 100}%` }}
                    >
                      <span className="bar-label">{proposal.publicVoteCount}</span>
                    </div>
                    <span className="bar-title">{proposal.title.substring(0, 10)}...</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "about" && (
          <div className="about-tab">
            <div className="about-card">
              <h2>FHE 同態加密投票系統</h2>
              <div className="tech-flow">
                <div className="flow-step">
                  <div className="step-number">1</div>
                  <div className="step-content">
                    <h4>數據加密</h4>
                    <p>使用 Zama FHE 技術對投票權重進行加密</p>
                  </div>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step">
                  <div className="step-number">2</div>
                  <div className="step-content">
                    <h4>鏈上存儲</h4>
                    <p>加密數據安全存儲在區塊鏈上</p>
                  </div>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step">
                  <div className="step-number">3</div>
                  <div className="step-content">
                    <h4>同態計算</h4>
                    <p>在加密數據上直接進行計票操作</p>
                  </div>
                </div>
                <div className="flow-arrow">→</div>
                <div className="flow-step">
                  <div className="step-number">4</div>
                  <div className="step-content">
                    <h4>結果驗證</h4>
                    <p>通過零知識證明驗證計票結果</p>
                  </div>
                </div>
              </div>
              
              <div className="feature-list">
                <h3>核心特性</h3>
                <ul>
                  <li>🔐 投票權重完全加密</li>
                  <li>📊 支持同態計票操作</li>
                  <li>👥 保護投票者隱私</li>
                  <li>🏠 促進社區和諧</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </main>

      {showCreateModal && (
        <CreateProposalModal 
          onSubmit={createProposal}
          onClose={() => setShowCreateModal(false)}
          creating={creatingProposal}
          proposalData={newProposalData}
          setProposalData={setNewProposalData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedProposal && (
        <ProposalDetailModal 
          proposal={selectedProposal}
          onClose={() => setSelectedProposal(null)}
          decryptData={() => decryptData(selectedProposal.id)}
          isDecrypting={fheIsDecrypting}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </span>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

const CreateProposalModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  proposalData: any;
  setProposalData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, proposalData, setProposalData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'weight') {
      const intValue = value.replace(/[^\d]/g, '');
      setProposalData({ ...proposalData, [name]: intValue });
    } else {
      setProposalData({ ...proposalData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>創建新提案</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 加密保護</strong>
            <p>投票權重將使用同態加密技術進行保護</p>
          </div>
          
          <div className="form-group">
            <label>提案標題 *</label>
            <input 
              type="text" 
              name="title" 
              value={proposalData.title}
              onChange={handleChange}
              placeholder="輸入提案標題..."
            />
          </div>
          
          <div className="form-group">
            <label>提案描述</label>
            <textarea 
              name="description"
              value={proposalData.description}
              onChange={handleChange}
              placeholder="詳細描述提案內容..."
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>投票權重 (整數) *</label>
            <input 
              type="number" 
              name="weight" 
              value={proposalData.weight}
              onChange={handleChange}
              placeholder="輸入權重數值..."
              min="0"
              step="1"
            />
            <div className="input-hint">FHE 加密整數數據</div>
          </div>
          
          <div className="form-group">
            <label>分類</label>
            <select 
              name="category"
              value={proposalData.category}
              onChange={handleChange}
            >
              <option value="general">一般事務</option>
              <option value="finance">財務審議</option>
              <option value="facility">設施維護</option>
              <option value="security">安全管理</option>
            </select>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button 
            onClick={onSubmit}
            disabled={creating || isEncrypting || !proposalData.title || !proposalData.weight}
            className="submit-btn"
          >
            {creating || isEncrypting ? "加密並創建中..." : "創建提案"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ProposalDetailModal: React.FC<{
  proposal: VoteProposal;
  onClose: () => void;
  decryptData: () => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ proposal, onClose, decryptData, isDecrypting }) => {
  const [localDecrypted, setLocalDecrypted] = useState<number | null>(null);

  const handleDecrypt = async () => {
    const result = await decryptData();
    setLocalDecrypted(result);
  };

  return (
    <div className="modal-overlay">
      <div className="modal large">
        <div className="modal-header">
          <h2>提案詳情</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="modal-body">
          <div className="proposal-detail">
            <div className="detail-section">
              <h3>{proposal.title}</h3>
              <p className="proposal-description">{proposal.description}</p>
            </div>
            
            <div className="detail-grid">
              <div className="detail-item">
                <label>創建者</label>
                <span>{proposal.creator.substring(0, 8)}...{proposal.creator.substring(34)}</span>
              </div>
              <div className="detail-item">
                <label>創建時間</label>
                <span>{new Date(proposal.timestamp * 1000).toLocaleString()}</span>
              </div>
              <div className="detail-item">
                <label>投票數</label>
                <span>{proposal.publicVoteCount}</span>
              </div>
              <div className="detail-item">
                <label>狀態</label>
                <span className={`status-tag ${proposal.status}`}>
                  {proposal.status === 'active' ? '進行中' : '已結束'}
                </span>
              </div>
            </div>
            
            <div className="encryption-section">
              <h4>FHE 加密數據</h4>
              <div className="encryption-status">
                <div className="status-info">
                  <span>權重數據: </span>
                  <strong>
                    {proposal.isVerified ? 
                      `${proposal.decryptedValue} (鏈上驗證)` : 
                      localDecrypted !== null ?
                      `${localDecrypted} (本地解密)` :
                      "🔒 加密中"
                    }
                  </strong>
                </div>
                <button 
                  onClick={handleDecrypt}
                  disabled={isDecrypting || proposal.isVerified}
                  className={`decrypt-btn ${proposal.isVerified ? 'verified' : ''}`}
                >
                  {isDecrypting ? "解密中..." : 
                   proposal.isVerified ? "✅ 已驗證" : 
                   localDecrypted !== null ? "🔄 重新驗證" : "🔓 驗證解密"}
                </button>
              </div>
              
              <div className="fhe-explanation">
                <div className="explanation-icon">ℹ️</div>
                <p>使用 FHE 技術對投票權重進行加密，確保投票過程的隱私保護和結果的可驗證性</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">關閉</button>
          {!proposal.isVerified && (
            <button 
              onClick={handleDecrypt}
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "驗證中..." : "鏈上驗證"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;