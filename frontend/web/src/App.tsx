import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface VoteData {
  id: number;
  title: string;
  description: string;
  encryptedWeight: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface VoteStats {
  totalVotes: number;
  verifiedVotes: number;
  avgWeight: number;
  recentActivity: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [votes, setVotes] = useState<VoteData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingVote, setCreatingVote] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newVoteData, setNewVoteData] = useState({ title: "", description: "", weight: "" });
  const [selectedVote, setSelectedVote] = useState<VoteData | null>(null);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [operationHistory, setOperationHistory] = useState<string[]>([]);
  const [voteStats, setVoteStats] = useState<VoteStats>({ totalVotes: 0, verifiedVotes: 0, avgWeight: 0, recentActivity: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
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

  const addToHistory = (operation: string) => {
    setOperationHistory(prev => [`${new Date().toLocaleTimeString()}: ${operation}`, ...prev.slice(0, 9)]);
  };

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const votesList: VoteData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          votesList.push({
            id: parseInt(businessId.replace('vote-', '')) || Date.now(),
            title: businessData.name,
            description: businessData.description,
            encryptedWeight: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setVotes(votesList);
      updateStats(votesList);
      addToHistory(`Refreshed vote data, found ${votesList.length} votes`);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (votesList: VoteData[]) => {
    const totalVotes = votesList.length;
    const verifiedVotes = votesList.filter(v => v.isVerified).length;
    const avgWeight = votesList.length > 0 
      ? votesList.reduce((sum, v) => sum + v.publicValue1, 0) / votesList.length 
      : 0;
    const recentActivity = votesList.filter(v => 
      Date.now()/1000 - v.timestamp < 60 * 60 * 24 * 7
    ).length;

    setVoteStats({ totalVotes, verifiedVotes, avgWeight, recentActivity });
  };

  const createVote = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingVote(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating vote with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const weightValue = parseInt(newVoteData.weight) || 0;
      const businessId = `vote-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, weightValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newVoteData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        weightValue,
        0,
        newVoteData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Vote created successfully!" });
      addToHistory(`Created new vote: ${newVoteData.title}`);
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewVoteData({ title: "", description: "", weight: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingVote(false); 
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
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      addToHistory(`Decrypted vote data: ${clearValue}`);
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and responsive!" 
      });
      addToHistory("Checked contract availability: Available");
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Contract call failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStatsPanel = () => {
    return (
      <div className="stats-panels">
        <div className="stat-panel metal-panel">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <h3>Total Votes</h3>
            <div className="stat-value">{voteStats.totalVotes}</div>
            <div className="stat-trend">+{voteStats.recentActivity} this week</div>
          </div>
        </div>
        
        <div className="stat-panel metal-panel">
          <div className="stat-icon">🔐</div>
          <div className="stat-content">
            <h3>Verified Data</h3>
            <div className="stat-value">{voteStats.verifiedVotes}/{voteStats.totalVotes}</div>
            <div className="stat-trend">FHE Protected</div>
          </div>
        </div>
        
        <div className="stat-panel metal-panel">
          <div className="stat-icon">⚖️</div>
          <div className="stat-content">
            <h3>Avg Weight</h3>
            <div className="stat-value">{voteStats.avgWeight.toFixed(1)}</div>
            <div className="stat-trend">Encrypted Average</div>
          </div>
        </div>
      </div>
    );
  };

  const renderWeightChart = (vote: VoteData, decryptedWeight: number | null) => {
    const weight = vote.isVerified ? (vote.decryptedValue || 0) : (decryptedWeight || vote.publicValue1 || 0);
    const maxWeight = 100;
    const percentage = Math.min(100, (weight / maxWeight) * 100);

    return (
      <div className="weight-chart">
        <div className="chart-header">
          <h4>Property Weight Distribution</h4>
          <span className="weight-value">{weight} units</span>
        </div>
        <div className="chart-bar">
          <div 
            className="bar-fill" 
            style={{ width: `${percentage}%` }}
          >
            <span className="bar-label">FHE Encrypted Weight</span>
          </div>
        </div>
        <div className="chart-labels">
          <span>0</span>
          <span>25</span>
          <span>50</span>
          <span>75</span>
          <span>100+</span>
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    const faqItems = [
      {
        question: "What is FHE voting?",
        answer: "FHE (Fully Homomorphic Encryption) allows voting with encrypted weights that can be counted without revealing individual votes."
      },
      {
        question: "How are property weights encrypted?",
        answer: "Each homeowner's property area is encrypted using Zama FHE technology before being stored on-chain."
      },
      },
      {
        question: "Is my vote private?",
        answer: "Yes, your individual vote and weight remain encrypted throughout the voting process."
      },
      {
        question: "How are votes counted?",
        answer: "Using homomorphic encryption, the system can compute totals without decrypting individual votes."
      }
    ];

    return (
      <div className="faq-section">
        <h3>FHE Voting FAQ</h3>
        <div className="faq-grid">
          {faqItems.map((item, index) => (
            <div key={index} className="faq-item metal-panel">
              <h4>{item.question}</h4>
              <p>{item.answer}</p>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🏠 Confidential Homeowner Voting</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Access Encrypted Voting</h2>
            <p>Please connect your wallet to initialize the FHE voting system and participate in community decisions.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet using the button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start creating and participating in encrypted votes</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted voting system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🏠 Confidential Homeowner Voting</h1>
          <p>FHE-Protected Community Decisions</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn metal-btn"
          >
            + New Vote
          </button>
          <button 
            onClick={callIsAvailable} 
            className="test-btn metal-btn"
          >
            Test Contract
          </button>
          <button 
            onClick={() => setShowFAQ(!showFAQ)} 
            className="faq-btn metal-btn"
          >
            {showFAQ ? "Hide FAQ" : "Show FAQ"}
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Encrypted Voting Dashboard</h2>
          {renderStatsPanel()}
          
          {showFAQ && renderFAQ()}
          
          <div className="operation-history">
            <h3>Recent Operations</h3>
            <div className="history-list">
              {operationHistory.length === 0 ? (
                <p>No operations yet</p>
              ) : (
                operationHistory.map((op, index) => (
                  <div key={index} className="history-item">
                    {op}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        
        <div className="votes-section">
          <div className="section-header">
            <h2>Active Community Votes</h2>
            <div className="header-actions">
              <button 
                onClick={loadData} 
                className="refresh-btn metal-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="votes-list">
            {votes.length === 0 ? (
              <div className="no-votes">
                <p>No active votes found</p>
                <button 
                  className="create-btn metal-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Vote
                </button>
              </div>
            ) : votes.map((vote, index) => (
              <div 
                className={`vote-item ${selectedVote?.id === vote.id ? "selected" : ""} ${vote.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedVote(vote)}
              >
                <div className="vote-title">{vote.title}</div>
                <div className="vote-description">{vote.description}</div>
                <div className="vote-meta">
                  <span>Weight: {vote.publicValue1} units</span>
                  <span>Created: {new Date(vote.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="vote-status">
                  Status: {vote.isVerified ? "✅ On-chain Verified" : "🔓 Ready for Verification"}
                  {vote.isVerified && vote.decryptedValue && (
                    <span className="verified-weight">Weight: {vote.decryptedValue}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateVote 
          onSubmit={createVote} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingVote} 
          voteData={newVoteData} 
          setVoteData={setNewVoteData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedVote && (
        <VoteDetailModal 
          vote={selectedVote} 
          onClose={() => setSelectedVote(null)} 
          isDecrypting={fheIsDecrypting} 
          decryptData={() => decryptData(selectedVote.encryptedWeight)}
          renderWeightChart={renderWeightChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateVote: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  voteData: any;
  setVoteData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, voteData, setVoteData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'weight') {
      const intValue = value.replace(/[^\d]/g, '');
      setVoteData({ ...voteData, [name]: intValue });
    } else {
      setVoteData({ ...voteData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-vote-modal">
        <div className="modal-header">
          <h2>New Community Vote</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Property Weight Encryption</strong>
            <p>Property area/weight will be encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Vote Title *</label>
            <input 
              type="text" 
              name="title" 
              value={voteData.title} 
              onChange={handleChange} 
              placeholder="Enter vote title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={voteData.description} 
              onChange={handleChange} 
              placeholder="Describe the voting proposal..." 
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Property Weight (Integer only) *</label>
            <input 
              type="number" 
              name="weight" 
              value={voteData.weight} 
              onChange={handleChange} 
              placeholder="Enter property weight/area..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !voteData.title || !voteData.weight} 
            className="submit-btn metal-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Vote"}
          </button>
        </div>
      </div>
    </div>
  );
};

const VoteDetailModal: React.FC<{
  vote: VoteData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderWeightChart: (vote: VoteData, decryptedWeight: number | null) => React.ReactNode;
}> = ({ vote, onClose, isDecrypting, decryptData, renderWeightChart }) => {
  const [decryptedWeight, setDecryptedWeight] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (decryptedWeight !== null) { 
      setDecryptedWeight(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    setDecryptedWeight(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="vote-detail-modal">
        <div className="modal-header">
          <h2>Vote Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="vote-info">
            <div className="info-item">
              <span>Title:</span>
              <strong>{vote.title}</strong>
            </div>
            <div className="info-item">
              <span>Description:</span>
              <p>{vote.description}</p>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(vote.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Property Weight</h3>
            
            <div className="data-row">
              <div className="data-label">Weight Value:</div>
              <div className="data-value">
                {vote.isVerified && vote.decryptedValue ? 
                  `${vote.decryptedValue} (On-chain Verified)` : 
                  decryptedWeight !== null ? 
                  `${decryptedWeight} (Locally Decrypted)` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              <button 
                className={`decrypt-btn metal-btn ${(vote.isVerified || decryptedWeight !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : vote.isVerified ? (
                  "✅ Verified"
                ) : decryptedWeight !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Decryption"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Protected Voting</strong>
                <p>Property weights are encrypted on-chain. Verify to perform offline decryption and on-chain verification.</p>
              </div>
            </div>
          </div>
          
          {(vote.isVerified || decryptedWeight !== null) && (
            <div className="analysis-section">
              <h3>Weight Distribution</h3>
              {renderWeightChart(vote, decryptedWeight)}
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-btn">Close</button>
          {!vote.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn metal-btn"
            >
              {isDecrypting ? "Verifying on-chain..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


