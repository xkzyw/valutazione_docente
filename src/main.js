const express = require("express");
const { MongoClient } = require("mongodb");
const config = require("./config.json");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const app = express();

const LISTEN_PORT = config.port;

app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));

app.use(cors())

const mongodb = new MongoClient(`mongodb://${config.host}:27017/Zhou_ValutazioniDocenti`);

// Verifica se il token è valido e non è scaduto
// Ritorna il valore contenuto nel token nel caso se valido
// Altrimenti ritorna false
function verifyToken(token){
    let res = null;
    jwt.verify(token, config.secret, (err, decoded) => {
        if(err){
            res = false;
        }else{
            res = decoded;
        }
    });

    return res;
}

app.post("/login", (req, res) => {
    let email = req.body.user;
    let passwd = req.body.password;

    mongodb.connect()
        .then(async (mongoclient) => {
            // Risultato da completare e restituire
            let result = {
                token: null,
                email: email,
            };

            // Collecgamento al collection dei utenti e credenziali
            let utenti_collection = mongoclient.db().collection("Utenti");
            let cred_collection = mongoclient.db().collection("Credenziali");

            // Cerco se esiste la credenziale inserito
            let cred = await cred_collection.findOne({email: email, password: passwd}, {
                projection: {
                    _id: 0
                }
            });

            if(!cred){
                res.json({message: "Utente non esistente o password errato"}).end();
                return;
            }

            // Ottengo dal database lo studente con il email assocciato
            let utente = await utenti_collection.findOne({email: email}, {
                projection: {
                    tipo: 1,
                    _id: 0
                }
            });
            
            mongoclient.close();

            // Contenuto del token
            let body = {}

            // Nel caso se email esiste
            if(utente){
                if(utente.tipo == "A"){
                    body.tipo = "A";
                }else if(utente.tipo == "S"){
                    // result.cognome = studente.cognome;
                    // result.nome = studente.nome;
                    body.tipo = "S";
                }else if(utente.tipo == "D"){
                    body.tipo = "D";
                }
            }else{
                res.json({message: "Utente non esistente o password errato"}).end();
                return;
            }

            body.email = result.email;

            // Creao un nuovo token
            let token = jwt.sign(body, config.secret, {
                expiresIn: config.expireTime
            });

            result.token = token;

            res.json(result);
            res.end();
        })

});

app.post("/get_docenti", (req, res) => {
    let token = req.body.token;

    // Ottengo dati dal token
    let data = verifyToken(token);

    // Se token valido
    if(data){
        let {email, tipo} = data;

        // Se non è un studente
        if(tipo != "S"){
            res.json({message: "Riservato allo studente"}).end();
        }

        mongodb.connect()
            .then(async (mongoclient) => {
                let utenti_collection = mongoclient.db().collection("Utenti");
                let config_collection = mongoclient.db().collection("Config");

                // Configurazione dal db
                let config = await config_collection.find({}, {
                    projection: {
                        _id: 0
                    }
                }).toArray();

                //Parametri di configurazioni salvati nel db
                config = config[0];

                // Se votazione è chiusa
                if(!config.open){
                    res.json({messaggio: "Votazione terminata"}).end();
                    return
                }else{
                    // Lo studente autenticato
                    let studente = await utenti_collection.findOne({email: email}, {
                            projection: {
                                _id: 0,
                                docenti_valutati: 1,
                                classe: 1
                            }
                    });

                    // Tutti i docenti del calsse di questo studente
                    let lista_docenti = await utenti_collection.find({tipo: "D", "classi_materie.nome": studente.classe}).toArray();

                    // Docenti non valutati
                    let non_val = [];

                    // Per ogni docenti dello studente
                    for(let doc of lista_docenti){
                        // Se esiste nella lista dei docenti valutati
                        let found = false;
                        // Per ogni docente valutato dallo studente
                        for(let val_doc of studente.docenti_valutati){
                            // Se il docente è nella lista dei docenti valutati
                            if(doc.email === val_doc.email){
                                found = true;
                                break;
                            }
                        }

                        // Se non viene trovato 
                        if(!found){

                            // Materia in cui insegna nella classe dello studente
                            let mat = doc.classi_materie.filter((val) => {
                                return val.nome == studente.classe
                            })[0];

                            non_val.push({nome: doc.nome, cognome: doc.cognome, mailDocente: doc.email, materie: mat.materie});
                        }
                    }

                    mongoclient.close();

                    res.json({classe: studente.classe, docenti: non_val, email: data.email});
                    res.end();
                }
            });
    }else{
        res.json({messaggio: "Token scaduto o non valido"}).end();
        return;
    }
});

app.get("/get_domande", (req, res) => {
    mongodb.connect()
        .then(async (mongoclient) => {
            let domande_collection = mongoclient.db().collection("Domande");

            // Lista di tutti le domande
            let lista_domande = await domande_collection.find({}).toArray();
            mongoclient.close();

            res.json(lista_domande);
            res.end();
        });
});

app.post("/valuta_docente", (req, res) => {
    let token = req.body.token;

    let data = verifyToken(token);

    if(!data){
        res.json({messaggio: "Token scaduto o non valido"}).end();
        return
    } 

    let valutazione = req.body;

    mongodb.connect()
        .then(async (mongoclient) => {
            let voti_collection = mongoclient.db().collection("Voti");
            let utenti_collection = mongoclient.db().collection("Utenti");

            // Parametro per la ricerda del docente interessato
            let doc_param = {email: valutazione.mailDocente}

            // Array di materie valutati con le relative valutazioni
            let materie = valutazione.materie;

            let docente = await voti_collection.findOne(doc_param);

            // Se non esiste un voto per tale docente inserire un nuovo
            if(!docente){
                await voti_collection.insertOne({
                    email: valutazione.mailDocente,
                    materie: []
                });

                // Docente aggiornato, precedentemente null
                docente = await voti_collection.findOne(doc_param);
            }

            // Per ogni materia valutato inviato dal client 
            materie.forEach((valuta_materia) => {
                // Se è già votato nel database tale materia  
                let mat = docente.materie.find((materia_valutata) => materia_valutata.nome == valuta_materia.nomeMateria);
                if(mat){
                    // Per ogni domanda valutato
                    valuta_materia.valutazioni.forEach((valuta_domanda) => {
                        // Verifico se esiste già la domanda
                        if(mat.valutazioni.find((valutazione_db) => valutazione_db.id_domanda == valuta_domanda.idDomanda)){
                            voti_collection.updateOne(doc_param, {"$push":{
                                "materie.$[mat].valutazioni.$[val].voto": 
                                    valuta_domanda.voto
                            }}, {
                                arrayFilters:[
                                    {"mat.nome": valuta_materia.nomeMateria},
                                    {"val.id_domanda": valuta_domanda.idDomanda}
                                ]
                            });
                        }else{
                            // Non esiste nel db la domanda da valutare, quindi lo aggiungo
                            voti_collection.updateOne(doc_param, {"$push":{
                                "materie.$[mat].valutazioni": 
                                    {
                                        id_domanda: valuta_domanda.idDomanda,
                                        voto: [
                                            valuta_domanda.voto
                                        ]
                                    }
                            }}, {
                                arrayFilters:[
                                    {"mat.nome": valuta_materia.nomeMateria},
                                ]
                            });
                        }
                    })
                }else{
                    // Non esiste la meteria nel db del docente
                    
                    // Creao array delle votazioni
                    let tmp = [];

                    valuta_materia.valutazioni.forEach((valuta_domanda) => {
                        tmp.push({
                            id_domanda: valuta_domanda.idDomanda,
                            voto: [
                                valuta_domanda.voto
                            ]
                        })
                    });

                    voti_collection.updateOne(doc_param, {"$push":{
                        "materie": 
                            {
                                nome: valuta_materia.nomeMateria,
                                valutazioni:tmp
                            }
                    }});
                }
            });

            // Aggiornare la lista dei docenti valutati
            utenti_collection.updateOne({email: data.email}, {$push: {
                valutato: valutazione.mailDocente
            }});
            
            res.json({messaggio: "Valutazione inserita con successo"}).end();
        });
});

app.post("/admin_console", (req, res) => {
    let token = req.body.token;

    let data = verifyToken(token);

    // Se token valido ed è un amministratore
    if(data && data.tipo == "A"){ 
        mongodb.connect()
            .then(async(mongoclient) => {
                let config_collection = mongoclient.db().collection("Config");

                // Configurazione del app nel db
                let config_param = await config_collection.findOne({});
                
                // Se valutazione è terminata o non
                if(config_param.open){
                    res.json([{
                            button: "Carica dati",
                            urlEndpoint: "carica_dati"
                        },
                        {
                            button: "Stop votazioni",
                            urlEndpoint: "stop"
                        }
                    ]);
                }else{
                    res.json([{
                            button: "Carica dati",
                            urlEndpoint: "carica_dati"
                        },
                        {
                            button: "Start votazioni",
                            urlEndpoint: "start"
                        }
                    ]);
                }

                res.end();
            })

    }else{
        res.sendStatus(404).end();
    }
});

// Inizio valutazione
app.post("/start", (req, res) => {
    let token = req.body.token;

    let data = verifyToken(token);

    if(data && data.tipo == "A"){ 
        mongodb.connect()
            .then(async(mongoclient) => {
                let config_collection = mongoclient.db().collection("Config");

                // Aggiorno parametro {open} a abilitato
                config_collection.updateOne({}, {$set: {open: true}});

                res.json({messaggio: "Votazione comminciate"}).end();
            }).finally()
    }else{
        res.sendStatus(404).end();
    }
});

// Termina votazione
app.post("/stop", (req, res) => {
    let token = req.body.token;

    let data = verifyToken(token);

    if(data && data.tipo == "A"){ 
        mongodb.connect()
        .then(async(mongoclient) => {
            let config_collection = mongoclient.db().collection("Config");

            // Aggiorno parametro {open} a disabilitato
            config_collection.updateOne({}, {$set: {open: false}})
            res.json({messaggio: "Votazione concluse"}).end();
        });
    }else{ 
        res.sendStatus(404).end();
    }
})

app.post("/view_docente", (req, res) => {
    let token = req.body.token;

    let data = verifyToken(token);

    // Se token è valido ed è un docente
    if(data && data.tipo == "D"){ 
        mongodb.connect()
            .then(async(mongoclient) => {
                let utenti_collection = mongoclient.db().collection("Utenti");
                let voti_collection = mongoclient.db().collection("Voti");
                let domande_collection = mongoclient.db().collection("Domande");

                // Tutte le domande del db
                let domande = await domande_collection.find({}).toArray();

                // Il docente interessato
                let docente = await utenti_collection.findOne({email: data.email});
                // I voti del docente
                let voti = await voti_collection.findOne({email: data.email});

                // Se è stato valutato
                if(voti){
                    // Per ogni materia che il docente insegna ed è stato valutato dai studenti
                    voti.materie = voti.materie.map((val) => {
                        val.valutazioni = val.valutazioni.map((valutazione) => {
                            // La descrizione della domanda che corrisponde al id_domanda
                            let domanda = domande.filter((dom) => dom.id == valutazione.id_domanda)[0];
                            // Modifica la struttura della valutazione tale che il {voto} diventa la media dei voti
                            // e la {domanda} diventa la descrizione
                            return {
                                voto: valutazione.voto.reduce((acc, curr) => acc + curr) / valutazione.voto.length,
                                domanda: domanda.domanda
                            }
                        })

                        return val;
                    });

                    // Informazioni aggiuntive
                    voti.cognome = docente.cognome;
                    voti.nome = docente.nome;
                    voti.email = docente.email;

                    res.json(voti).end();
                }else{
                    res.json({messaggio: "Non hai nessun votazione"}).end();
                }
            });
    }else{  
        res.sendStatus(404).end();
    }
})
 
app.post("/carica_dati", (req, res) => {
    let cred = require("./json/credenziali.json");
    let utenti = require("./json/utenti.json");
    let domande = require("./json/domande.json");

    mongodb.connect()
        .then(async (mongoclient) => {
            let domande_collection = mongoclient.db().collection("Domande");
            let utenti_collection = mongoclient.db().collection("Utenti");
            let cred_collection = mongoclient.db().collection("Credenziali");

            await domande_collection.deleteMany({});
            await utenti_collection.deleteMany({});
            await cred_collection.deleteMany({});

            domande_collection.insertMany(domande);
            utenti_collection.insertMany(utenti);
            cred_collection.insertMany(cred);

            res.json({messaggio: "Dati inseriti con successo"}).end();
        });
})

app.listen(LISTEN_PORT, () => {});